// data.js — versión FINAL (Google Sheets CSV -> productos)
// ✅ Incluye Destacados=TRUE -> destacado:true (para “Destacados por categoría”)
// ✅ Incluye promo_group (para promos mixtas: 2+1+1 = 4 y aplica precio promo)
// Compatible con GitHub Pages

// ✅ TU LINK (CSV publicado)
export const PRODUCTS_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJAgesFM5B0OTnVSvcOxrtC4VlI1ijay6erm7XnX8zjRtwUnbX-M0_4yXxRhcairW01hFOjoKQHW7t/pub?gid=1128238455&single=true&output=csv";

const CATALOG_CACHE_KEY = "catalog_cache_v1";
const DEFAULT_TIMEOUT_MS = 10000;

/* =========================
   Helpers defensivos
   ========================= */

function toStr(v) {
  return String(v ?? "").trim();
}

function toBool(v) {
  // ✅ robusto: TRUE/FALSE, verdadero/falso, 1/0, si/no, yes/no
  if (v === true) return true;
  if (v === false) return false;

  const s = toStr(v).toLowerCase();
  if (!s) return false;

  if (
    s === "true" ||
    s === "verdadero" ||
    s === "1" ||
    s === "si" ||
    s === "sí" ||
    s === "yes"
  )
    return true;

  if (s === "false" || s === "falso" || s === "0" || s === "no") return false;

  return false;
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = toStr(v)
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/,/g, "."); // por si viene 1.234,56
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseTags(v) {
  const s = toStr(v);
  if (!s) return [];
  // Permite: "cola; coca; 2lt" o "cola, coca, 2lt"
  return s
    .split(/[;,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function getApiBase() {
  const raw =
    typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE
      ? String(import.meta.env.VITE_API_BASE).trim()
      : "";
  return raw.replace(/\/$/, "");
}

function withTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json, text/csv, text/plain, */*" },
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

function readCatalogCache() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.products) || parsed.products.length === 0) return null;
    return {
      products: parsed.products,
      updatedAt: Number(parsed.updatedAt) || null,
    };
  } catch {
    return null;
  }
}

function writeCatalogCache(products, updatedAt) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      CATALOG_CACHE_KEY,
      JSON.stringify({ products, updatedAt: Number(updatedAt) || Date.now() })
    );
  } catch {
    // sin storage disponible, ignoramos
  }
}

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
    const id = toStr(p?.id);
    combined += `${id}|`;
  }
  return `${list.length}:${hashString(combined)}`;
}

/**
 * CSV parser simple y robusto:
 * - soporta comillas
 * - soporta comas dentro de comillas
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      // escape de comillas: ""
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
      if (ch === "\r" && next === "\n") i++; // CRLF
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }

    cur += ch;
  }

  // último campo
  row.push(cur);
  rows.push(row);

  // limpiar filas vacías
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

/* =========================
   Normalización a tu formato
   ========================= */

function getDestacadosValue(r) {
  // ✅ Soporta nombres típicos de columna
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
  // ✅ Soporta nombres típicos de columna (por si cambias el encabezado)
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

function rowToProduct(r) {
  // Campos base
  const id = toStr(r.id);
  if (!id) return null;

  const nombre = toStr(r.nombre);
  const categoria = toStr(r.categoria);
  const subcategoria = toStr(r.subcategoria);

  const precio_base = toNumber(r.precio_base);
  const imagen = toStr(r.imagen_url) || null;

  const marca = toStr(r.marca) || null;
  const presentacion = toStr(r.presentacion) || null;

  const tags = parseTags(r.tags);

  // activo
  const activo = r.activo === "" ? true : toBool(r.activo); // si está vacío, asumimos activo
  if (!activo) return null;

  // Carrusel / oferta
  const ofertaCarrusel = toBool(r.oferta_carrusel);

  // ✅ DESTACADOS
  const destacado = toBool(getDestacadosValue(r));

  // ✅ promo_group (para promos mixtas)
  const promo_group = toStr(getPromoGroupValue(r)) || null;

  // Promo por cantidad (DPC)
  const promoMin = toNumber(r.promo_min_qty);
  const promoPrecio = toNumber(r.promo_precio);

  const dpc =
    promoMin > 0 && promoPrecio > 0
      ? { tramos: [{ min: promoMin, precio: promoPrecio }] }
      : undefined;

  // Producto final (formato que tu web consume)
  return {
    id,
    nombre: nombre || id,
    categoria: categoria || "Otros",
    subcategoria: subcategoria || "Otros",
    precio: precio_base > 0 ? precio_base : 0,
    oferta: ofertaCarrusel, // ✅ carrusel de ofertas
    imagen,
    marca,
    presentacion,
    tags,
    destacado, // ✅ CLAVE: ahora tu app.js lo ve como boolean REAL

    // ✅ CLAVE: habilita “mix & match”
    promo_group,

    ...(dpc ? { dpc } : {}),
    ...(r.stock !== undefined && r.stock !== "" ? { stock: toNumber(r.stock) } : {}),
  };
}

/* =========================
   Fetch principal
   ========================= */

async function fetchCatalogFromApi() {
  const base = getApiBase();
  const apiUrl = base ? `${base}/api/catalog` : "/api/catalog";
  const url = apiUrl.includes("?") ? `${apiUrl}&_ts=${Date.now()}` : `${apiUrl}?_ts=${Date.now()}`;

  const res = await withTimeout(url, DEFAULT_TIMEOUT_MS);

  if (!res.ok) {
    const error = new Error(`Error HTTP ${res.status} al cargar catálogo`);
    error.status = res.status;
    throw error;
  }

  const payload = await res.json();
  if (!Array.isArray(payload?.products) || payload.products.length === 0) {
    throw new Error("Catálogo vacío desde API.");
  }

  return {
    products: payload.products,
    updatedAt: payload.updatedAt || Date.now(),
  };
}

export async function fetchProducts() {
  let res;
  try {
    // cache-bust para que vea cambios al toque
    const url = PRODUCTS_URL.includes("?")
      ? `${PRODUCTS_URL}&_ts=${Date.now()}`
      : `${PRODUCTS_URL}?_ts=${Date.now()}`;

    res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "text/csv, text/plain, */*" },
    });
  } catch (err) {
    throw new Error(
      "No se pudo conectar para cargar la planilla (CSV). Verificá conexión o link publicado."
    );
  }

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Error HTTP ${res.status} al cargar CSV de Google Sheets`);
  }

  // Si Google devolvió HTML (error de publicación), lo detectamos
  if (text.trim().startsWith("<!DOCTYPE html") || text.includes("<html")) {
    throw new Error(
      "El link no está devolviendo CSV (parece HTML). Revisá: Publicar en la web → CSV."
    );
  }

  const rows = parseCSV(text);
  const objs = rowsToObjects(rows);

  const products = [];
  for (const r of objs) {
    const p = rowToProduct(r);
    if (p) products.push(p);
  }

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error(
      "CSV cargó, pero no se generaron productos. Revisá que exista la columna 'id' y tenga valores."
    );
  }

  return products;
}

export async function loadProductsWithCache() {
  const cached = readCatalogCache();
  const cachedSignature = cached ? getProductsSignature(cached.products) : "";

  const updatePromise = (async () => {
    try {
      let fresh;
      try {
        fresh = await fetchCatalogFromApi();
      } catch (err) {
        const products = await fetchProducts();
        fresh = { products, updatedAt: Date.now() };
      }

      const freshSignature = getProductsSignature(fresh.products);
      const changed = !cached || cachedSignature !== freshSignature;

      if (changed) {
        writeCatalogCache(fresh.products, fresh.updatedAt);
      }

      return { changed, products: fresh.products, updatedAt: fresh.updatedAt };
    } catch (err) {
      return { error: err?.message || "No se pudo actualizar el catálogo." };
    }
  })();

  if (cached?.products?.length) {
    return {
      products: cached.products,
      fromCache: true,
      lastUpdated: cached.updatedAt,
      updatePromise,
    };
  }

  const first = await updatePromise;
  if (first?.error) {
    throw new Error(first.error);
  }

  return {
    products: first.products,
    fromCache: false,
    lastUpdated: first.updatedAt,
    updatePromise: Promise.resolve(first),
  };
}
