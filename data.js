// data.js — versión FINAL (API Vercel -> JSON estático -> CSV emergencia)
// ✅ Zod (validación/normalización masiva)
// ✅ Cache local + actualización en background
// ✅ Mantiene Destacados=TRUE -> destacado:true (para “Destacados por categoría”)
// ✅ Mantiene promo_group + dpc (promo_min_qty / promo_precio)
// ✅ Soporta respuestas API: { products:[...], degraded?, updatedAt? } o directamente [...]
//
// NOTA IMPORTANTE:
// - Este archivo NO exige que instales Zod si ya lo tenés en tu bundle.
//   Si NO lo tenés instalado, instalalo: `npm i zod` (o quitamos Zod).
//
// Autor: Adaptado para Makabra (Vercel + futura integración Scanntech)

import { z } from "zod";
import { FRONTEND_CONFIG } from "./src/config.js";

// ==========================================
// 1) CONFIG DE FUENTES
// ==========================================

export const PRODUCTS_URL = FRONTEND_CONFIG.csvUrl;

const SOURCES = [
  { url: "/api/catalog", type: "json", timeoutMs: 9000 },
  { url: "/products.json", type: "json", timeoutMs: 5000 },
  ...(PRODUCTS_URL ? [{ url: PRODUCTS_URL, type: "csv", timeoutMs: 10000 }] : []),
];

const CATALOG_CACHE_KEY = "catalog_cache_v3";

// ==========================================
// 2) Helpers defensivos
// ==========================================

function toStr(v) {
  return String(v ?? "").trim();
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;

  const s = toStr(v).toLowerCase();
  if (!s) return false;

  if (s === "true" || s === "verdadero" || s === "1" || s === "si" || s === "sí" || s === "yes") return true;
  if (s === "false" || s === "falso" || s === "0" || s === "no") return false;

  return false;
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = toStr(v).replace(/\$/g, "").replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseTags(v) {
  const s = toStr(v);
  if (!s) return [];
  return s.split(/[;,]/g).map((x) => x.trim()).filter(Boolean);
}

function getApiBase() {
  const raw =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE
      ? String(import.meta.env.VITE_API_BASE).trim()
      : "";
  return raw.replace(/\/$/, "");
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json, text/csv, text/plain, */*",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// 3) Cache local
// ==========================================

function readCatalogCache() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.products) || parsed.products.length === 0) return null;

    return {
      products: parsed.products,
      updatedAt: Number(parsed.updatedAt) || null,
      source: parsed.source || null,
      degraded: Boolean(parsed.degraded),
      rejectedCount: Number(parsed.rejectedCount) || 0,
    };
  } catch {
    return null;
  }
}

function writeCatalogCache(payload) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      CATALOG_CACHE_KEY,
      JSON.stringify({
        products: payload.products,
        updatedAt: Number(payload.updatedAt) || Date.now(),
        source: payload.source || null,
        degraded: Boolean(payload.degraded),
        rejectedCount: Number(payload.rejectedCount) || 0,
      })
    );
  } catch {
    // storage lleno o bloqueado -> ignorar
  }
}

// Firma simple para detectar cambios sin depender del orden de claves
function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash;
}

function getProductsSignature(list) {
  if (!Array.isArray(list) || list.length === 0) return "0";
  let combined = "";
  for (const p of list) {
    const tags = Array.isArray(p?.tags) ? p.tags.join(";") : "";
    const dpc = p?.dpc ? JSON.stringify(p.dpc) : "";
    const stock = p?.stock ?? "";
    combined += [
      toStr(p?.id),
      toStr(p?.nombre),
      toStr(p?.categoria),
      toStr(p?.subcategoria),
      String(p?.precio ?? ""),
      String(p?.oferta ?? ""),
      toStr(p?.imagen),
      toStr(p?.marca),
      toStr(p?.presentacion),
      tags,
      String(p?.destacado ?? ""),
      toStr(p?.promo_group),
      dpc,
      String(stock),
    ].join("|");
    combined += "||";
  }
  return `${list.length}:${hashString(combined)}`;
}

// ==========================================
// 4) CSV parser robusto (mantengo tu versión buena)
// ==========================================

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cur += '"';
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cur);
      cur = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  row.push(cur);
  rows.push(row);

  return rows.filter((r) => r.some((c) => toStr(c) !== ""));
}

function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const header = rows[0].map((h) => toStr(h));
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j];
      if (!key) continue;
      obj[key] = r[j] ?? "";
    }
    out.push(obj);
  }
  return out;
}

// ==========================================
// 5) Zod schema + normalización final al formato Makabra
//    (incluye destacados + promo_group + dpc + tags + imagen)
// ==========================================

function getDestacadosValue(r) {
  return (
    r.Destacados ??
    r.destacados ??
    r.destacado ??
    r.DESTACADOS ??
    r["Destacados "] ??
    r["destacados "] ??
    r.Featured ??
    r.featured
  );
}

function getPromoGroupValue(r) {
  return (
    r.promo_group ??
    r.PROMO_GROUP ??
    r["promo group"] ??
    r["Promo Group"] ??
    r.promogroup ??
    r.PromoGroup ??
    r.grupo_promo ??
    r.GrupoPromo ??
    r.grupo ??
    r.Grupo
  );
}

// Producto “final” que usa tu UI
const ProductSchema = z
  .object({
    id: z.union([z.string().min(1), z.number().transform(String)]),

    nombre: z.coerce.string().trim().min(1).catch("Producto sin nombre"),

    categoria: z.coerce.string().trim().catch("Otros"),
    subcategoria: z.coerce.string().trim().catch("Otros"),

    // precio final
    precio: z.coerce.number().nonnegative().catch(0),

    // flags
    oferta: z.preprocess(toBool, z.boolean()).catch(false),
    destacado: z.preprocess(toBool, z.boolean()).catch(false),

    // opcionales
    imagen: z.coerce.string().optional().catch(""),
    imagen_url: z.coerce.string().optional().catch(""),
    marca: z.coerce.string().optional().catch(""),
    presentacion: z.coerce.string().optional().catch(""),
    tags: z.any().optional(),
    promo_group: z.coerce.string().optional().catch(""),
    stock: z.coerce.number().optional().catch(undefined),

    // promos DPC (si viene)
    promo_min_qty: z.coerce.number().optional(),
    promo_precio: z.coerce.number().optional(),
    dpc: z.any().optional(),
  })
  .passthrough()
  .transform((r) => {
    // tags
    const tags = Array.isArray(r.tags) ? r.tags : parseTags(r.tags);

    // imagen
    const imagen = toStr(r.imagen) || toStr(r.imagen_url) || null;

    // promo_group
    const promo_group = toStr(r.promo_group) || null;

    // dpc: si viene ya armado lo respetamos, si no lo armamos desde promo_min_qty/promo_precio
    const promoMin = toNumber(r.promo_min_qty);
    const promoPrecio = toNumber(r.promo_precio);
    const dpc =
      r.dpc ||
      (promoMin > 0 && promoPrecio > 0
        ? { tramos: [{ min: promoMin, precio: promoPrecio }] }
        : undefined);

    return {
      id: toStr(r.id),
      nombre: toStr(r.nombre) || toStr(r.id),
      categoria: toStr(r.categoria) || "Otros",
      subcategoria: toStr(r.subcategoria) || "Otros",
      precio: toNumber(r.precio),
      oferta: Boolean(r.oferta),
      imagen,
      marca: toStr(r.marca) || null,
      presentacion: toStr(r.presentacion) || null,
      tags,
      destacado: Boolean(r.destacado),
      promo_group,
      ...(dpc ? { dpc } : {}),
      ...(r.stock !== undefined && r.stock !== "" ? { stock: toNumber(r.stock) } : {}),
    };
  });

// ==========================================
// 6) Extract list (API puede devolver array o {products})
// ==========================================

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.products)) return payload.products;
  return [];
}

// ==========================================
// 7) Mapeo previo por fuente (para tolerar nombres distintos)
// ==========================================

function mapRowAnySource(item) {
  // Soporta: API Scanntech-like, products.json antiguo, CSV actual
  const mapped = {
    ...item,
    id: item.id ?? item.codigoInterno ?? item.scanntech_id ?? item.scanntechId,

    nombre: item.nombre ?? item.descripcion ?? item.name,

    categoria: item.categoria ?? item.category ?? item.descripcionCorta,
    subcategoria: item.subcategoria ?? item.subcategory ?? "",

    // Precio: prioriza "precio", si no, "precio_base", si no, "precioRegular"
    precio: item.precio ?? item.precio_base ?? item.precioRegular ?? item.price ?? item.precioBase,

    // Oferta: usa oferta_carrusel del CSV, o esPrecioOferta del API
    oferta: item.oferta ?? item.oferta_carrusel ?? item.esPrecioOferta ?? item.offer,

    // Imagen
    imagen: item.imagen ?? item.img,
    imagen_url: item.imagen_url ?? item.image_url ?? item.imageUrl,

    // Destacados
    destacado: item.destacado ?? getDestacadosValue(item) ?? item.oferta_carrusel,

    // promo_group
    promo_group: getPromoGroupValue(item),

    // promo dpc
    promo_min_qty: item.promo_min_qty,
    promo_precio: item.promo_precio,
    dpc: item.dpc,

    // tags y extras
    tags: item.tags,
    marca: item.marca,
    presentacion: item.presentacion,
    stock: item.stock,
  };

  return mapped;
}

// ==========================================
// 8) Fetch desde una fuente (json/csv) + zod validate
// ==========================================

async function fetchFromSource(source) {
  const base = getApiBase();
  const finalUrl =
    source.url.startsWith("/api/") && base
      ? `${base}${source.url}`
      : source.url;

  const url = finalUrl.includes("?")
    ? `${finalUrl}&_ts=${Date.now()}`
    : `${finalUrl}?_ts=${Date.now()}`;

  try {
    const res = await fetchWithTimeout(url, source.timeoutMs);

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    let payload;
    let degradedFromApi = false;
    let updatedAtFromApi = null;

    if (source.type === "json") {
      payload = await res.json();
      degradedFromApi = Boolean(payload?.degraded);
      updatedAtFromApi = payload?.updatedAt ? Number(payload.updatedAt) : null;
    } else {
      const text = await res.text();

      if (text.trim().startsWith("<!DOCTYPE html") || text.includes("<html")) {
        throw new Error("La fuente CSV devolvió HTML (link mal publicado).");
      }

      const rows = parseCSV(text);
      payload = rowsToObjects(rows);
    }

    const list = extractList(payload);
    if (!Array.isArray(list) || list.length === 0) throw new Error("Fuente vacía o formato inválido");

    const products = [];
    let rejected = 0;

    for (const item of list) {
      const mapped = mapRowAnySource(item);
      const result = ProductSchema.safeParse(mapped);
      if (result.success) products.push(result.data);
      else rejected++;
    }

    if (products.length === 0) throw new Error("Validación falló: 0 productos válidos");

    return {
      products,
      updatedAt: updatedAtFromApi || Date.now(),
      source: source.url,
      degraded: degradedFromApi || source.url !== "/api/catalog",
      rejectedCount: rejected,
    };
  } catch (err) {
    console.warn(`[Catalog] Falló fuente ${source.url}: ${err?.message || err}`);
    return null;
  }
}

// ==========================================
// 9) Loader con cache + update en background (API pública)
// ==========================================

export async function loadProductsWithCache() {
  const cached = readCatalogCache();
  const cachedSignature = cached ? getProductsSignature(cached.products) : "";

  const updatePromise = (async () => {
    for (const source of SOURCES) {
      console.log(`📡 Intentando cargar desde: ${source.url}`);
      const fresh = await fetchFromSource(source);

      if (fresh?.products?.length) {
        const freshSignature = getProductsSignature(fresh.products);
        const changed = !cached || cachedSignature !== freshSignature;

        if (changed) writeCatalogCache(fresh);

        return {
          changed,
          products: fresh.products,
          updatedAt: fresh.updatedAt,
          source: fresh.source,
          degraded: fresh.degraded,
          rejectedCount: fresh.rejectedCount,
        };
      }
    }

    // Si fallaron todas:
    return {
      error: "No se pudo actualizar el catálogo (fallaron todas las fuentes).",
      products: cached?.products ?? [],
      updatedAt: Date.now(),
      source: "none",
      degraded: true,
      rejectedCount: 0,
    };
  })();

  // Si hay cache, devolvemos instantáneo + promise de update
  if (cached?.products?.length) {
    return {
      products: cached.products,
      fromCache: true,
      lastUpdated: cached.updatedAt,
      source: cached.source,
      degraded: cached.degraded,
      rejectedCount: cached.rejectedCount,
      updatePromise,
    };
  }

  // Sin cache: esperamos primer update
  const first = await updatePromise;
  if (first?.error) throw new Error(first.error);

  return {
    products: first.products,
    fromCache: false,
    lastUpdated: first.updatedAt,
    source: first.source,
    degraded: first.degraded,
    rejectedCount: first.rejectedCount,
    updatePromise: Promise.resolve(first),
  };
}
