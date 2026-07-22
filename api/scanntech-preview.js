// api/scanntech-preview.js

import { MOCK_ARTICLES } from "./mock-scanntech.js";

export const config = { runtime: "nodejs" };

const CACHE_CONTROL = "no-store, max-age=0";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.end(JSON.stringify(body, null, 2));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePromo(article) {
  const cantidad = numberOrNull(article?.promocion?.cantidad);
  const precio = numberOrNull(article?.promocion?.precioUnitario);
  if (!cantidad || !precio) return null;
  return { cantidad, precio };
}

async function loadSupabaseProducts(baseUrl, secret) {
  const products = [];
  const pageSize = 1000;
  let offset = 0;

  while (true) {
    const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/rest/v1/productos`);
    endpoint.searchParams.set(
      "select",
      "id,nombre,precio_base,activo,promo_min_qty,promo_precio",
    );
    endpoint.searchParams.set("limit", String(pageSize));
    endpoint.searchParams.set("offset", String(offset));

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
      throw new Error(`Supabase ${response.status}: ${text.slice(0, 700)}`);
    }

    const page = JSON.parse(text);
    if (!Array.isArray(page)) {
      throw new Error("Supabase devolvió una respuesta inesperada");
    }

    products.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return products;
}

function compareArticle(article, product) {
  const issues = [];
  const mockPrice = numberOrNull(article.precio);
  const mockPromo = normalizePromo(article);

  if (!String(article.codigo || "").trim()) issues.push("codigo_faltante");
  if (!String(article.descripcion || "").trim()) issues.push("descripcion_faltante");
  if (mockPrice === null) issues.push("precio_invalido");

  if (issues.length > 0) {
    return {
      codigo: article.codigo || null,
      descripcion: article.descripcion || null,
      escenario: article.escenario || null,
      accion: "error_datos",
      problemas: issues,
    };
  }

  if (!product) {
    return {
      codigo: article.codigo,
      descripcion: article.descripcion,
      escenario: article.escenario || null,
      accion: "producto_nuevo",
      precio_scanntech: mockPrice,
      activo_scanntech: Boolean(article.activo),
      promocion_scanntech: mockPromo,
    };
  }

  const currentPrice = numberOrNull(product.precio_base) ?? 0;
  const currentPromoQty = numberOrNull(product.promo_min_qty);
  const currentPromoPrice = numberOrNull(product.promo_precio);
  const currentPromo =
    currentPromoQty && currentPromoPrice
      ? { cantidad: currentPromoQty, precio: currentPromoPrice }
      : null;

  const changes = [];

  if (currentPrice !== mockPrice) {
    changes.push({
      campo: "precio_base",
      actual: currentPrice,
      nuevo: mockPrice,
    });
  }

  if (Boolean(product.activo) !== Boolean(article.activo)) {
    changes.push({
      campo: "activo",
      actual: Boolean(product.activo),
      nuevo: Boolean(article.activo),
    });
  }

  if (JSON.stringify(currentPromo) !== JSON.stringify(mockPromo)) {
    changes.push({
      campo: "promocion",
      actual: currentPromo,
      nuevo: mockPromo,
    });
  }

  return {
    codigo: article.codigo,
    descripcion: article.descripcion,
    nombre_supabase: product.nombre || null,
    escenario: article.escenario || null,
    accion: changes.length ? "actualizar" : "sin_cambios",
    cambios: changes,
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
      error: "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel",
    });
  }

  try {
    const products = await loadSupabaseProducts(baseUrl, secret);
    const byId = new Map(products.map((product) => [String(product.id), product]));
    const resultados = MOCK_ARTICLES.map((article) =>
      compareArticle(article, byId.get(String(article.codigo))),
    );

    const resumen = {
      total_mock: resultados.length,
      coincidencias: resultados.filter((item) => item.accion !== "producto_nuevo" && item.accion !== "error_datos").length,
      sin_cambios: resultados.filter((item) => item.accion === "sin_cambios").length,
      para_actualizar: resultados.filter((item) => item.accion === "actualizar").length,
      productos_nuevos: resultados.filter((item) => item.accion === "producto_nuevo").length,
      errores_datos: resultados.filter((item) => item.accion === "error_datos").length,
    };

    return sendJson(res, 200, {
      modo: "preview",
      escritura_habilitada: false,
      proveedor: "scanntech_mock",
      generadoEn: new Date().toISOString(),
      total_productos_supabase: products.length,
      resumen,
      resultados,
      aviso: "Este endpoint solamente compara datos. No modifica Supabase ni la página web.",
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: "No se pudo realizar la comparación",
      message: String(error?.message || error),
      escritura_habilitada: false,
    });
  }
}
