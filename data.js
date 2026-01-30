// data.js — versión FINAL (Google Sheets CSV -> productos)
// ✅ Incluye Destacados=TRUE -> destacado:true (para “Destacados por categoría”)
// Compatible con GitHub Pages

// ✅ TU LINK (CSV publicado)
export const PRODUCTS_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJAgesFM5B0OTnVSvcOxrtC4VlI1ijay6erm7XnX8zjRtwUnbX-M0_4yXxRhcairW01hFOjoKQHW7t/pub?gid=1128238455&single=true&output=csv";

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

  if (s === "true" || s === "verdadero" || s === "1" || s === "si" || s === "sí" || s === "yes")
    return true;

  if (s === "false" || s === "falso" || s === "0" || s === "no")
    return false;

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

  // ✅ DESTACADOS (lo que necesitabas)
  const destacado = toBool(getDestacadosValue(r));

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

    ...(dpc ? { dpc } : {}),
    ...(r.stock !== undefined && r.stock !== "" ? { stock: toNumber(r.stock) } : {}),
  };
}

/* =========================
   Fetch principal
   ========================= */

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
