import { getApiConfig, sanitizeIp } from "./_config.js";

const CODE_REGEX = /^\d{5}$/;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_SHEET_GID = "0";
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;

const ipHits = new Map();

function sanitizeCode(input) {
  return String(input ?? "").replace(/\D/g, "").trim();
}

function getLast3(code) {
  const value = String(code || "");
  return value.slice(-3);
}

function toStr(value) {
  return String(value ?? "").trim();
}

function hitRateLimit(ip) {
  const now = Date.now();
  const prev = (ipHits.get(ip) || []).filter((ts) => now - ts < RATE_WINDOW_MS);
  prev.push(now);
  ipHits.set(ip, prev);
  return prev.length > RATE_LIMIT;
}

function resolveDirectoryCsvUrl() {
  const { deliveryDirectoryCsvUrl } = getApiConfig();
  if (deliveryDirectoryCsvUrl) return deliveryDirectoryCsvUrl;

  const sheetId = toStr(process.env.DELIVERY_DIRECTORY_SHEET_ID);
  if (!sheetId) {
    throw new Error("MISSING_DIRECTORY_URL");
  }

  const gid = toStr(process.env.DELIVERY_DIRECTORY_SHEET_GID) || DEFAULT_SHEET_GID;
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

function readDirectoryFromEnv() {
  const raw = process.env.DELIVERY_DIRECTORY_JSON;
  if (!raw) {
    throw new Error("MISSING_DIRECTORY");
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("INVALID_DIRECTORY_FORMAT");
  }

  return parsed;
}

function parseCsv(csvText) { /* unchanged parser */
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      currentCell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);
  return rows;
}

function mapRowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const headers = rows[0].map((header) => toStr(header).toLowerCase());
  return rows.slice(1).map((row) => {
    const rowObject = {};
    for (let index = 0; index < headers.length; index += 1) {
      const key = headers[index];
      if (!key) continue;
      rowObject[key] = row[index] ?? "";
    }
    return rowObject;
  });
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "text/csv, text/plain, */*" }, cache: "no-store", signal: controller.signal });
    const text = await res.text();
    return { res, text };
  } finally { clearTimeout(timeoutId); }
}

function mapRowToProfile(row) {
  const code = sanitizeCode(row.code ?? row.codigo ?? row.cod);
  const name = toStr(row.name ?? row.nombre);
  const address = toStr(row.address ?? row.direccion ?? row.dirección);
  const phone = toStr(row.phone ?? row.telefono ?? row.teléfono);
  return { code, name, address, phone };
}

async function readDirectoryFromSheets() {
  const csvUrl = resolveDirectoryCsvUrl();
  const { res, text } = await fetchTextWithTimeout(csvUrl, DEFAULT_TIMEOUT_MS);
  if (!res.ok) throw new Error(`DIRECTORY_HTTP_${res.status}`);
  return mapRowsToObjects(parseCsv(text)).map(mapRowToProfile).filter(Boolean);
}

async function readDirectory() {
  try { return await readDirectoryFromSheets(); } catch { return readDirectoryFromEnv(); }
}

function sanitizeProfile(entry) {
  if (!entry || typeof entry !== "object") return null;
  const code = sanitizeCode(entry.code);
  const name = String(entry.name ?? "").trim();
  const address = String(entry.address ?? "").trim();
  const phone = String(entry.phone ?? "").trim();
  if (!CODE_REGEX.test(code) || !name || !address || !phone) return null;
  return { code, name, address, phone };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ valid: false, error: "METHOD_NOT_ALLOWED" });
  }

  const ip = sanitizeIp(req);
  if (hitRateLimit(ip)) {
    return res.status(429).json({ valid: false, error: "RATE_LIMITED" });
  }

  let code = "";
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    code = sanitizeCode(body?.code);
  } catch {
    return res.status(400).json({ valid: false, error: "BAD_REQUEST" });
  }

  if (!CODE_REGEX.test(code)) {
    return res.status(400).json({ valid: false, error: "BAD_REQUEST" });
  }

  try {
    const directory = await readDirectory();
    const match = directory.find((entry) => sanitizeCode(entry?.code) === code);
    const profile = sanitizeProfile(match);
    if (!profile) return res.status(404).json({ valid: false, error: "NOT_FOUND" });

    const exposePii = getApiConfig().deliveryExposePii;
    const safeProfile = exposePii ? profile : { code: profile.code, name: profile.name };
    return res.status(200).json({ valid: true, profile: safeProfile });
  } catch {
    console.error("[delivery] validation failed for ***" + getLast3(code));
    return res.status(500).json({ valid: false, error: "INTERNAL_ERROR" });
  }
}
