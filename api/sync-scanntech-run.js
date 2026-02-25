import crypto from "node:crypto";
import { getApiConfig, getHeader } from "./_config.js";

export const config = { runtime: "nodejs" };
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
let currentLock = null;
let lastStatus = null;

function json(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); }
const toStr = (v) => String(v ?? "").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function base64url(input) { return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }

function getServiceAccount() {
  const { googleServiceAccountJson } = getApiConfig();
  if (!googleServiceAccountJson) throw new Error("MISSING_GOOGLE_SERVICE_ACCOUNT_JSON");
  let raw = googleServiceAccountJson;
  if (!raw.includes("client_email")) raw = Buffer.from(raw, "base64").toString("utf8");
  const parsed = JSON.parse(raw);
  return { email: toStr(parsed.client_email), privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n") };
}

async function getAccessToken() {
  const { email, privateKey } = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iss: email, scope: SHEETS_SCOPE, aud: TOKEN_AUDIENCE, iat: now, exp: now + 3600 }))}`;
  const signer = crypto.createSign("RSA-SHA256"); signer.update(unsigned); signer.end();
  const jwt = `${unsigned}.${base64url(signer.sign(privateKey))}`;
  const tokenRes = await fetch(TOKEN_AUDIENCE, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString() });
  if (!tokenRes.ok) throw new Error("TOKEN_REQUEST_FAILED");
  return toStr((await tokenRes.json()).access_token);
}

async function sheets(path, accessToken, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`SHEETS_${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function withRetry(fn, retries = 3) {
  let n = 0;
  while (true) {
    try { return await fn(); } catch (e) { n += 1; if (n > retries) throw e; await sleep(250 * (2 ** n)); }
  }
}

function normalizeScanntechProduct(p) {
  const id = toStr(p.scanntech_id ?? p.id ?? p.codigoInterno);
  const barcode = toStr(p.barcode ?? p.codigoBarras ?? p.ean);
  if (!id && !barcode) return null;
  const active = p.activo === false || p.active === false || p.inactivo === true ? false : true;
  return {
    scanntech_id: id,
    barcode,
    nombre: toStr(p.nombre ?? p.name ?? p.descripcion),
    precio_base: Number(p.precio_base ?? p.price ?? p.precioRegular ?? 0) || 0,
    stock: Number(p.stock ?? p.inventory ?? 0) || 0,
    activo: active,
    promociones_json: JSON.stringify(Array.isArray(p.promociones ?? p.promotions) ? (p.promociones ?? p.promotions) : []),
    imagen_url: toStr(p.imagen_url ?? p.image_url ?? p.image ?? ""),
  };
}

async function ensureSheet(accessToken, spreadsheetId, title, headers) {
  const meta = await sheets(`${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`, accessToken, { method: "GET" });
  const titles = (meta.sheets || []).map((s) => toStr(s?.properties?.title));
  if (!titles.includes(title)) {
    await sheets(`${encodeURIComponent(spreadsheetId)}:batchUpdate`, accessToken, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) });
    await sheets(`${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${title}!A1`)}?valueInputOption=RAW`, accessToken, { method: "PUT", body: JSON.stringify({ values: [headers] }) });
  }
}

async function syncRun() {
  const cfg = getApiConfig();
  if (!cfg.scanntechBaseUrl || !cfg.scanntechApiKey || !cfg.productsSheetId) throw new Error("MISSING_REQUIRED_ENV");
  const startedAt = new Date().toISOString();
  const timeoutMs = Number(cfg.scanntechTimeoutMs || 12000);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${cfg.scanntechBaseUrl.replace(/\/$/, "")}${cfg.scanntechProductsPath}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${cfg.scanntechApiKey}`, Accept: "application/json" }, signal: controller.signal });
  clearTimeout(timer);
  if (!r.ok) throw new Error(`SCANNTECH_${r.status}`);
  const payload = await r.json();
  const list = (Array.isArray(payload) ? payload : payload?.data || []).map(normalizeScanntechProduct).filter(Boolean);

  const accessToken = await getAccessToken();
  const productsTab = cfg.productsSheetTab;
  const runTab = "sync_runs";
  const productHeaders = ["scanntech_id", "barcode", "nombre", "precio_base", "stock", "activo", "promociones_json", "imagen_url", "updated_at"];
  const runHeaders = ["startedAt", "finishedAt", "ok", "added", "updated", "deactivated", "errorsCount", "notes"];
  await ensureSheet(accessToken, cfg.productsSheetId, productsTab, productHeaders);
  await ensureSheet(accessToken, cfg.productsSheetId, runTab, runHeaders);

  const existing = await sheets(`${encodeURIComponent(cfg.productsSheetId)}/values/${encodeURIComponent(productsTab)}`, accessToken, { method: "GET" });
  const rows = existing.values || [productHeaders];
  const head = rows[0];
  const idxId = head.indexOf("scanntech_id"); const idxBarcode = head.indexOf("barcode"); const idxImage = head.indexOf("imagen_url");
  const index = new Map();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const id = toStr(row[idxId]); const b = toStr(row[idxBarcode]);
    if (id) index.set(`id:${id}`, i);
    if (b) index.set(`b:${b}`, i);
  }

  let added = 0, updated = 0, deactivated = 0;
  for (const p of list) {
    const key = p.scanntech_id ? `id:${p.scanntech_id}` : `b:${p.barcode}`;
    const rowPos = index.get(key);
    if (rowPos == null) {
      rows.push([p.scanntech_id, p.barcode, p.nombre, p.precio_base, p.stock, p.activo ? "TRUE" : "FALSE", p.promociones_json, p.imagen_url, new Date().toISOString()]);
      added += 1;
      continue;
    }
    const current = rows[rowPos];
    const finalImage = p.imagen_url || toStr(current[idxImage]);
    rows[rowPos] = [p.scanntech_id || toStr(current[idxId]), p.barcode || toStr(current[idxBarcode]), p.nombre, p.precio_base, p.stock, p.activo ? "TRUE" : "FALSE", p.promociones_json, finalImage, new Date().toISOString()];
    updated += 1;
    if (!p.activo) deactivated += 1;
  }

  await withRetry(() => sheets(`${encodeURIComponent(cfg.productsSheetId)}/values/${encodeURIComponent(`${productsTab}!A1`)}?valueInputOption=RAW`, accessToken, { method: "PUT", body: JSON.stringify({ values: rows }) }));
  const finishedAt = new Date().toISOString();
  const runRow = [[startedAt, finishedAt, "TRUE", added, updated, deactivated, 0, `fetched=${list.length}`]];
  await withRetry(() => sheets(`${encodeURIComponent(cfg.productsSheetId)}/values/${encodeURIComponent(`${runTab}!A:H`)}:append?valueInputOption=RAW`, accessToken, { method: "POST", body: JSON.stringify({ values: runRow }) }));
  return { startedAt, finishedAt, ok: true, added, updated, deactivated, errorsCount: 0, fetched: list.length };
}

export default async function handler(req, res) {
  const path = (req.url || "").split("?")[0];
  const wantStatus = path.endsWith("/status");
  const allowMethods = wantStatus ? "GET" : "POST";
  if (req.method !== (wantStatus ? "GET" : "POST")) {
    res.setHeader("Allow", allowMethods);
    return json(res, 405, { error: "Method Not Allowed" });
  }

  const expected = getApiConfig().syncToken;
  const token = getHeader(req, "x-sync-token");
  if (!expected) return json(res, 500, { error: "Missing SYNC_TOKEN env var" });
  if (!token) return json(res, 401, { error: "Unauthorized" });
  if (token !== expected) return json(res, 403, { error: "Forbidden" });

  if (wantStatus) return json(res, 200, { ok: true, status: lastStatus, running: Boolean(currentLock) });

  const now = Date.now();
  if (currentLock && now - currentLock < 10 * 60_000) return json(res, 409, { ok: false, error: "SYNC_ALREADY_RUNNING" });
  currentLock = now;

  try {
    const result = await syncRun();
    lastStatus = result;
    return json(res, 200, { ok: true, ...result });
  } catch (e) {
    const failed = { ok: false, error: String(e?.message || e), finishedAt: new Date().toISOString() };
    lastStatus = failed;
    return json(res, 500, failed);
  } finally {
    currentLock = null;
  }
}
