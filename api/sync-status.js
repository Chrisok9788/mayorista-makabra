// api/sync-status.js

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

async function loadLatestSync(baseUrl, secret) {
  const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/rest/v1/sincronizaciones`);
  endpoint.searchParams.set(
    "select",
    "id,origen,estado,started_at,finished_at,registros_procesados,registros_actualizados,registros_con_error,mensaje",
  );
  endpoint.searchParams.set("order", "started_at.desc");
  endpoint.searchParams.set("limit", "1");

  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`No se pudo leer el historial: Supabase ${response.status}: ${text.slice(0, 500)}`);
  }

  const rows = JSON.parse(text);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
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
    const [products, latestSyncRow] = await Promise.all([
      loadSupabaseProducts(baseUrl, secret),
      loadLatestSync(baseUrl, secret),
    ]);

    const byId = new Map(products.map((product) => [String(product.id), product]));
    const resultados = MOCK_ARTICLES.map((article) =>
      compareArticle(article, byId.get(String(article.codigo))),
    );
    const resumen = buildPreviewSummary(resultados);
    const ultimaSincronizacion = formatLatestSync(latestSyncRow);

    const hasSyncError = ultimaSincronizacion.estado === "error";
    const estadoGeneral =
      hasSyncError || resumen.errores_datos > 0 ? "advertencia" : "correcto";

    return sendJson(res, 200, {
      centro: "sincronizacion_makabra",
      version: 2,
      modo: "solo_lectura",
      escritura_habilitada: false,
      estado_general: estadoGeneral,
      generadoEn: new Date().toISOString(),
      duracion_ms: Date.now() - startedAt,
      ultima_sincronizacion_google_sheets: ultimaSincronizacion,
      conexiones: {
        google_sheets: {
          estado:
            ultimaSincronizacion.estado === "completada"
              ? "sincronizado"
              : ultimaSincronizacion.estado,
          ultima_ejecucion: ultimaSincronizacion.inicio || null,
        },
        supabase: {
          estado: "conectado",
          productos: products.length,
        },
        scanntech: {
          estado: "simulado",
          proveedor: "scanntech_mock",
          articulos: MOCK_ARTICLES.length,
        },
        pagina_web: {
          estado: "sin_modificaciones",
          fuente_catalogo: "supabase",
        },
      },
      cambios_detectados: {
        para_actualizar: resumen.para_actualizar,
        productos_nuevos: resumen.productos_nuevos,
        sin_cambios: resumen.sin_cambios,
        errores_datos: resumen.errores_datos,
      },
      accesos: {
        simulador: "/api/mock-scanntech",
        vista_previa: "/api/scanntech-preview",
        estado: "/api/sync-status",
      },
      siguiente_etapa: {
        nombre: "panel_visual",
        descripcion:
          "Crear una pantalla privada que muestre el estado, el historial y futuras acciones controladas.",
      },
      aviso:
        "Este centro muestra la sincronización real de Google Sheets y la comparación simulada de Scanntech. No ejecuta escrituras por sí mismo.",
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
