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

  const host = toStr(req.headers["x-forwarded-host"] || req.headers.host);
  const protocol =
    toStr(req.headers["x-forwarded-proto"]) ||
    (host.includes("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "https://mayorista-makabra.vercel.app";
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

  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 1000) };
  }

  if (!response.ok || body?.ok === false) {
    throw new Error(`${name}: ${body?.message || body?.error || `HTTP ${response.status}`}`);
  }

  return body;
}

function supabaseConfig() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !secret) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel");
  }
  return { baseUrl, secret };
}

async function writeAggregateLog(startedAt, summary, errorMessage = null) {
  try {
    const { baseUrl, secret } = supabaseConfig();
    const productCount = Number(summary?.productos?.processed || 0);
    const clientCount = Number(summary?.clientes?.clients_synced || 0);
    const categoryCount = Number(summary?.taxonomia?.categorias || 0);
    const subcategoryCount = Number(summary?.taxonomia?.subcategorias || 0);

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
        registros_actualizados:
          productCount + clientCount + categoryCount + subcategoryCount,
        registros_con_error: errorMessage ? 1 : 0,
        mensaje: errorMessage
          ? `Sincronización total con error: ${errorMessage}`.slice(0, 1000)
          : `Productos: ${productCount}; clientes: ${clientCount}; categorías: ${categoryCount}; subcategorías: ${subcategoryCount}`,
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

    summary.taxonomia = await runEndpoint(
      baseUrl,
      "/api/sync-taxonomy-supabase",
      token,
      "Sincronización de categorías y subcategorías",
    );

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
        duplicados_eliminados: Number(
          summary.clientes?.changed_code_duplicates_removed || 0,
        ),
        inactivos:
          Number(summary.clientes?.duplicates_deactivated || 0) +
          Number(summary.clientes?.missing_clients_deactivated || 0),
      },
      categorias: Number(summary.taxonomia?.categorias || 0),
      subcategorias: Number(summary.taxonomia?.subcategorias || 0),
      productos_activos: Number(summary.taxonomia?.productos_activos || 0),
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
    return sendJson(res, 500, {
      ok: false,
      error: "Falta configurar SYNC_TOKEN en Vercel",
    });
  }
  if (receivedToken !== expectedToken) {
    return sendJson(res, 401, {
      ok: false,
      error: "Token de sincronización incorrecto",
    });
  }

  if (runningPromise) {
    return sendJson(res, 409, {
      ok: false,
      error: "SYNC_ALREADY_RUNNING",
      message: "Ya hay una sincronización total en ejecución.",
    });
  }

  runningPromise = executeSync(getBaseUrl(req), expectedToken);
  try {
    return sendJson(res, 200, await runningPromise);
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
