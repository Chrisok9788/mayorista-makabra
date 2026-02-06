// data.js — versión FINAL (Google Sheets CSV -> productos)
// ✅ Incluye Destacados=TRUE -> destacado:true (para “Destacados por categoría”)
// ✅ Incluye promo_group (para promos mixtas: 2+1+1 = 4 y aplica precio promo)
// Compatible con GitHub Pages

// ✅ TU LINK (CSV publicado)
export const PRODUCTS_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJAgesFM5B0OTnVSvcOxrtC4VlI1ijay6erm7XnX8zjRtwUnbX-M0_4yXxRhcairW01hFOjoKQHW7t/pub?gid=1128238455&single=true&output=csv";

const CACHE_KEY = "catalog-cache-v1";
const CACHE_VERSION = 1;
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
  const imagen = toStr(r.imagen_url || r.imagen) || null;

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

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hashString(input) {
  let hash = 0;
  const s = String(input ?? "");
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function readCache() {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.products)) {
    return null;
  }
  return parsed;
}

function writeCache(products) {
  if (typeof localStorage === "undefined") return null;
  const payload = {
    version: CACHE_VERSION,
    lastUpdated: Date.now(),
    hash: hashString(JSON.stringify(products)),
    products,
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  return payload;
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "text/csv, text/plain, */*" },
      signal: controller.signal,
    });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProductsRemote(timeoutMs = DEFAULT_TIMEOUT_MS) {
  let res;
  let text;
  try {
    const url = PRODUCTS_URL.includes("?")
      ? `${PRODUCTS_URL}&_ts=${Date.now()}`
      : `${PRODUCTS_URL}?_ts=${Date.now()}`;

    ({ res, text } = await fetchTextWithTimeout(url, timeoutMs));
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Timeout al cargar la planilla (CSV). Intentá nuevamente.");
    }
    throw new Error(
      "No se pudo conectar para cargar la planilla (CSV). Verificá conexión o link publicado."
    );
  }

  if (!res.ok) {
    throw new Error(`Error HTTP ${res.status} al cargar CSV de Google Sheets`);
  }

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

export async function loadProductsWithCache({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cached = readCache();

  const updatePromise = fetchProductsRemote(timeoutMs)
    .then((products) => {
      const hash = hashString(JSON.stringify(products));
      const isSame = cached?.hash === hash;
      const payload = isSame ? cached : writeCache(products);
      return {
        products,
        fromCache: false,
        lastUpdated: payload?.lastUpdated ?? Date.now(),
        changed: !isSame,
      };
    })
    .catch((error) => ({ error }));

  if (cached?.products?.length) {
    return {
      products: cached.products,
      fromCache: true,
      lastUpdated: cached.lastUpdated,
      updatePromise,
    };
  }

  const result = await updatePromise;
  if (result?.error) throw result.error;
  return {
    products: result.products,
    fromCache: false,
    lastUpdated: result.lastUpdated,
    updatePromise: Promise.resolve(result),
  };
}
