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
    const products = await loadSupabaseProducts(baseUrl, secret);
    const byId = new Map(products.map((product) => [String(product.id), product]));
    const resultados = MOCK_ARTICLES.map((article) =>
      compareArticle(article, byId.get(String(article.codigo))),
    );
    const resumen = buildPreviewSummary(resultados);

    const estadoGeneral = resumen.errores_datos > 0 ? "advertencia" : "correcto";

    return sendJson(res, 200, {
      centro: "sincronizacion_makabra",
      version: 1,
      modo: "solo_lectura",
      escritura_habilitada: false,
      estado_general: estadoGeneral,
      generadoEn: new Date().toISOString(),
      duracion_ms: Date.now() - startedAt,
      conexiones: {
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
          "Crear una pantalla privada que muestre este estado y permita ejecutar futuras acciones de forma controlada.",
      },
      aviso:
        "Este centro todavía es informativo. No existe ninguna operación de escritura o sincronización real.",
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
