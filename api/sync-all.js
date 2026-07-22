export const config = { runtime: "nodejs" };

let runningPromise = null;

function toStr(value) {
  return String(value ?? "").trim();
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function getBaseUrl(req) {
  const configured = toStr(process.env.PUBLIC_SITE_URL).replace(/\/$/, "");
  if (configured) return configured;

  const forwardedHost = toStr(req.headers["x-forwarded-host"]);
  const host = forwardedHost || toStr(req.headers.host);
  const forwardedProto = toStr(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");

  if (!host) return "https://mayorista-makabra.vercel.app";
  return `${protocol}://${host}`;
}

async function readJsonResponse(response, name) {
  const text = await response.text();
  let body = null;

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 1000) };
  }

  if (!response.ok || body?.ok === false) {
    const detail = body?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(`${name}: ${detail}`);
  }

  return body;
}

async function runEndpoint(baseUrl, path, token, name) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "x-sync-token": token,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  return readJsonResponse(response, name);
}

function getSupabaseConfig() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!baseUrl || !secret) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel");
  }

  return { baseUrl, secret };
}

async function loadProductTaxonomy() {
  const { baseUrl, secret } = getSupabaseConfig();
  const products = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const endpoint = new URL(`${baseUrl}/rest/v1/productos`);
    endpoint.searchParams.set("select", "id,categoria,subcategoria,activo");
    endpoint.searchParams.set("activo", "eq.true");
    endpoint.searchParams.set("order", "id.asc");

    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
        Range: `${from}-${to}`,
        "Range-Unit": "items",
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Resumen de catálogo: Supabase ${response.status}: ${text.slice(0, 500)}`);
    }

    const rows = JSON.parse(text || "[]");
    if (!Array.isArray(rows)) break;
    products.push(...rows);
    if (rows.length < pageSize) break;
  }

  const categories = new Set();
  const subcategories = new Set();

  products.forEach((product) => {
    const category = toStr(product.categoria) || "Otros";
    const subcategory = toStr(product.subcategoria) || "Otros";
    categories.add(category);
    subcategories.add(`${category}\u0000${subcategory}`);
  });

  return {
    productos_activos: products.length,
    categorias: categories.size,
    subcategorias: subcategories.size,
  };
}

async function writeAggregateLog(startedAt, summary, errorMessage = null) {
  try {
    const { baseUrl, secret } = getSupabaseConfig();
    const productCount = Number(summary?.productos?.processed || 0);
    const clientCount = Number(summary?.clientes?.clients_synced || 0);
    const errors = errorMessage ? 1 : 0;

    await fetch(`${baseUrl}/rest/v1/sincronizaciones`, {
      method: "POST",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        origen: "sync_all",
        estado: errorMessage ? "error" : "completada",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        registros_procesados: productCount + clientCount,
        registros_actualizados: productCount + clientCount,
        registros_con_error: errors,
        mensaje: errorMessage
          ? `Sincronización total con error: ${errorMessage}`.slice(0, 1000)
          : `Productos: ${productCount}; clientes: ${clientCount}; categorías: ${Number(summary?.taxonomia?.categorias || 0)}; subcategorías: ${Number(summary?.taxonomia?.subcategorias || 0)}`,
      }),
    });
  } catch (error) {
    console.warn("[sync-all] No se pudo registrar el resumen", String(error?.message || error));
  }
}

async function executeSync(baseUrl, token) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const summary = {};

  try {
    summary.productos = await runEndpoint(
      baseUrl,
      "/api/sync-supabase",
      token,
      "Sincronización de productos",
    );

    summary.clientes = await runEndpoint(
      baseUrl,
      "/api/sync-clients-supabase",
      token,
      "Sincronización de clientes",
    );

    summary.taxonomia = await loadProductTaxonomy();

    const result = {
      ok: true,
      source: "google_sheets",
      destination: "supabase",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedMs,
      productos: {
        procesados: Number(summary.productos?.processed || 0),
      },
      clientes: {
        procesados: Number(summary.clientes?.rows_read || 0),
        sincronizados: Number(summary.clientes?.clients_synced || 0),
        filas_invalidas: Number(summary.clientes?.invalid_rows || 0),
        codigos_duplicados: Number(summary.clientes?.duplicate_codes || 0),
      },
      categorias: summary.taxonomia.categorias,
      subcategorias: summary.taxonomia.subcategorias,
      productos_activos: summary.taxonomia.productos_activos,
    };

    await writeAggregateLog(startedAt, summary);
    return result;
  } catch (error) {
    const message = String(error?.message || error);
    await writeAggregateLog(startedAt, summary, message);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const expectedToken = toStr(process.env.SYNC_TOKEN);
  const receivedToken = toStr(req.query?.token || req.headers["x-sync-token"]);

  if (!expectedToken) {
    return sendJson(res, 500, { ok: false, error: "Falta configurar SYNC_TOKEN en Vercel" });
  }

  if (receivedToken !== expectedToken) {
    return sendJson(res, 401, { ok: false, error: "Token de sincronización incorrecto" });
  }

  if (runningPromise) {
    return sendJson(res, 409, {
      ok: false,
      error: "SYNC_ALREADY_RUNNING",
      message: "Ya hay una sincronización total en ejecución.",
    });
  }

  const baseUrl = getBaseUrl(req);
  runningPromise = executeSync(baseUrl, expectedToken);

  try {
    const result = await runningPromise;
    return sendJson(res, 200, result);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: "SYNC_ALL_FAILED",
      message: String(error?.message || error),
    });
  } finally {
    runningPromise = null;
  }
}
