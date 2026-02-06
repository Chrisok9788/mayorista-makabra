const CSV_URL =
  process.env.CSV_URL ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJAgesFM5B0OTnVSvcOxrtC4VlI1ijay6erm7XnX8zjRtwUnbX-M0_4yXxRhcairW01hFOjoKQHW7t/pub?gid=1128238455&single=true&output=csv";

const DEFAULT_TIMEOUT_MS = 10000;

function toStr(v) {
  return String(v ?? "").trim();
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;

  const s = toStr(v).toLowerCase();
  if (!s) return false;

  if (s === "true" || s === "verdadero" || s === "1" || s === "si" || s === "sí" || s === "yes") {
    return true;
  }

  if (s === "false" || s === "falso" || s === "0" || s === "no") return false;

  return false;
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = toStr(v)
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseTags(v) {
  const s = toStr(v);
  if (!s) return [];
  return s
    .split(/[;,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

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

function rowToProduct(r) {
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

  const activo = r.activo === "" ? true : toBool(r.activo);
  if (!activo) return null;

  const ofertaCarrusel = toBool(r.oferta_carrusel);
  const destacado = toBool(getDestacadosValue(r));
  const promo_group = toStr(getPromoGroupValue(r)) || null;

  const promoMin = toNumber(r.promo_min_qty);
  const promoPrecio = toNumber(r.promo_precio);

  const dpc =
    promoMin > 0 && promoPrecio > 0
      ? { tramos: [{ min: promoMin, precio: promoPrecio }] }
      : undefined;

  return {
    id,
    nombre: nombre || id,
    categoria: categoria || "Otros",
    subcategoria: subcategoria || "Otros",
    precio: precio_base > 0 ? precio_base : 0,
    oferta: ofertaCarrusel,
    imagen,
    marca,
    presentacion,
    tags,
    destacado,
    promo_group,
    ...(dpc ? { dpc } : {}),
    ...(r.stock !== undefined && r.stock !== "" ? { stock: toNumber(r.stock) } : {}),
  };
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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const url = CSV_URL.includes("?") ? `${CSV_URL}&_ts=${Date.now()}` : `${CSV_URL}?_ts=${Date.now()}`;
    const { res: csvRes, text } = await fetchTextWithTimeout(url, DEFAULT_TIMEOUT_MS);

    if (!csvRes.ok) {
      return res.status(csvRes.status).json({ error: `Error HTTP ${csvRes.status} al cargar CSV` });
    }

    if (text.trim().startsWith("<!DOCTYPE html") || text.includes("<html")) {
      return res
        .status(502)
        .json({ error: "El link no está devolviendo CSV (parece HTML)." });
    }

    const rows = parseCSV(text);
    const objs = rowsToObjects(rows);

    const products = [];
    for (const r of objs) {
      const p = rowToProduct(r);
      if (p) products.push(p);
    }

    if (!products.length) {
      return res.status(502).json({
        error: "CSV cargó, pero no se generaron productos. Revisá que exista la columna 'id'.",
      });
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=3600");
    return res.status(200).json({
      products,
      updatedAt: Date.now(),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      return res.status(504).json({ error: "Timeout al cargar CSV." });
    }
    return res.status(500).json({ error: "No se pudo cargar el catálogo." });
  }
}
