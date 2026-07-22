import { MOCK_ARTICLES } from "./mock-scanntech.js";
import {
  buildPreviewSummary,
  compareArticle,
  loadSupabaseProducts,
} from "./scanntech-preview.js";

export const config = { runtime: "nodejs" };

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(body, null, 2));
}

function headers(secret, extra = {}) {
  return {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    Accept: "application/json",
    ...extra,
  };
}

async function supabaseGet(baseUrl, secret, table, params = {}, extraHeaders = {}) {
  const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => endpoint.searchParams.set(key, value));

  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: headers(secret, extraHeaders),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status} en ${table}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text || "[]");
}

async function loadLatestSync(baseUrl, secret) {
  const rows = await supabaseGet(baseUrl, secret, "sincronizaciones", {
    select:
      "id,origen,estado,started_at,finished_at,registros_procesados,registros_actualizados,registros_con_error,mensaje",
    order: "started_at.desc",
    limit: "1",
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadActiveClients(baseUrl, secret) {
  const rows = await supabaseGet(baseUrl, secret, "clientes", {
    select: "codigo",
    activo: "eq.true",
  });
  return Array.isArray(rows) ? rows.length : 0;
}

async function loadTaxonomy(baseUrl, secret) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const batch = await supabaseGet(
      baseUrl,
      secret,
      "productos",
      {
        select: "categoria,subcategoria",
        activo: "eq.true",
        order: "id.asc",
      },
      {
        Range: `${from}-${from + pageSize - 1}`,
        "Range-Unit": "items",
      },
    );

    if (!Array.isArray(batch)) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  const categories = new Set();
  const subcategories = new Set();

  rows.forEach((row) => {
    const category = String(row?.categoria || "Otros").trim() || "Otros";
    const subcategory = String(row?.subcategoria || "Otros").trim() || "Otros";
    categories.add(category);
    subcategories.add(`${category}\u0000${subcategory}`);
  });

  return {
    categorias: categories.size,
    subcategorias: subcategories.size,
  };
}

function formatLatestSync(row) {
  if (!row) {
    return {
      estado: "sin_registros",
      mensaje: "Todavía no hay sincronizaciones registradas.",
    };
  }

  const started = row.started_at ? new Date(row.started_at) : null;
  const finished = row.finished_at ? new Date(row.finished_at) : null;
  const durationMs =
    started && finished && Number.isFinite(started.getTime()) && Number.isFinite(finished.getTime())
      ? Math.max(0, finished.getTime() - started.getTime())
      : null;

  return {
    id: row.id,
    origen: row.origen || "desconocido",
    estado: row.estado || "desconocido",
    inicio: row.started_at || null,
    fin: row.finished_at || null,
    duracion_ms: durationMs,
    duracion_segundos: durationMs === null ? null : Number((durationMs / 1000).toFixed(2)),
    registros_procesados: Number(row.registros_procesados || 0),
    registros_actualizados: Number(row.registros_actualizados || 0),
    registros_con_error: Number(row.registros_con_error || 0),
    mensaje: row.mensaje || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const baseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !secret) {
    return sendJson(res, 500, {
      centro: "sincronizacion_makabra",
      estado_general: "error",
      error: "Faltan variables de Supabase en Vercel",
    });
  }

  const startedAt = Date.now();

  try {
    const [products, clients, taxonomy, latestSyncRow] = await Promise.all([
      loadSupabaseProducts(baseUrl, secret),
      loadActiveClients(baseUrl, secret),
      loadTaxonomy(baseUrl, secret),
      loadLatestSync(baseUrl, secret),
    ]);

    const byId = new Map(products.map((product) => [String(product.id), product]));
    const results = MOCK_ARTICLES.map((article) =>
      compareArticle(article, byId.get(String(article.codigo))),
    );
    const preview = buildPreviewSummary(results);
    const latestSync = formatLatestSync(latestSyncRow);

    const hasSyncError = latestSync.estado === "error";
    const estadoGeneral = hasSyncError || preview.errores_datos > 0 ? "advertencia" : "correcto";

    return sendJson(res, 200, {
      centro: "sincronizacion_makabra",
      version: 3,
      modo: "operativo",
      escritura_habilitada: true,
      estado_general: estadoGeneral,
      generadoEn: new Date().toISOString(),
      duracion_ms: Date.now() - startedAt,
      ultima_sincronizacion_google_sheets: latestSync,
      conexiones: {
        google_sheets: {
          estado: latestSync.estado === "completada" ? "sincronizado" : latestSync.estado,
          ultima_ejecucion: latestSync.inicio || null,
        },
        supabase: {
          estado: "conectado",
          productos: products.length,
          clientes: clients,
          categorias: taxonomy.categorias,
          subcategorias: taxonomy.subcategorias,
        },
        scanntech: {
          estado: "simulado",
          proveedor: "scanntech_mock",
          articulos: MOCK_ARTICLES.length,
        },
        pagina_web: {
          estado: "operativa",
          fuente_catalogo: "supabase",
        },
      },
      cambios_detectados: {
        para_actualizar: preview.para_actualizar,
        productos_nuevos: preview.productos_nuevos,
        sin_cambios: preview.sin_cambios,
        errores_datos: preview.errores_datos,
      },
      accesos: {
        sincronizar_todo: "/api/sync-all",
        sincronizar_productos: "/api/sync-supabase",
        sincronizar_clientes: "/api/sync-clients-supabase",
        simulador: "/api/mock-scanntech",
        vista_previa: "/api/scanntech-preview",
        estado: "/api/sync-status",
      },
      automatizacion: {
        proveedor: "github_actions",
        frecuencia_minutos: 5,
        endpoint: "/api/sync-all",
      },
      aviso:
        "El catálogo y los clientes se sincronizan juntos. Las categorías y subcategorías se calculan desde los productos activos.",
    });
  } catch (error) {
    return sendJson(res, 500, {
      centro: "sincronizacion_makabra",
      estado_general: "error",
      escritura_habilitada: false,
      generadoEn: new Date().toISOString(),
      error: "No se pudo obtener el estado de sincronización",
      message: String(error?.message || error),
    });
  }
}
