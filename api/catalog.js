// api/catalog.js — catálogo desde Supabase con respaldo en Google Sheets

export const config = { runtime: "nodejs" };

const CSV_URL =
  process.env.CSV_URL ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJAgesFM5B0OTnVSvcOxrtC4VlI1ijay6erm7XnX8zjRtwUnbX-M0_4yXxRhcairW01hFOjoKQHW7t/pub?gid=1128238455&single=true&output=csv";

const DEFAULT_TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS || 12000);
const SUPABASE_PAGE_SIZE = 1000;

const BROWSER_CACHE_CONTROL =
  "public, max-age=60, stale-while-revalidate=300";
const VERCEL_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=1800, stale-if-error=86400";

let inMemoryFallback = null;

function setCatalogCacheHeaders(res) {
  res.setHeader("Cache-Control", BROWSER_CACHE_CONTROL);
  res.setHeader("Vercel-CDN-Cache-Control", VERCEL_CACHE_CONTROL);
}

function toStr(value) {
  return String(value ?? "").trim();
}

function toBool(value) {
  if (value === true) return true;
  if (value === false) return false;
  return ["true", "verdadero", "1", "si", "sí", "yes"].includes(
    toStr(value).toLowerCase(),
  );
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = toStr(value)
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map(toStr).filter(Boolean);

  const text = toStr(value);
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(toStr).filter(Boolean);
    } catch {
      // Continúa con etiquetas separadas por coma o punto y coma.
    }
  }

  return text
    .split(/[;,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((item) => item.some((value) => toStr(value)));
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map(toStr);

  return rows.slice(1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      if (header) object[header] = row[index] ?? "";
    });
    return object;
  });
}

function firstValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function rowToProduct(row) {
  const id = toStr(firstValue(row, ["id", "ID", "codigoInterno", "scanntech_id"]));
  if (!id) return null;

  const nombre = toStr(firstValue(row, ["nombre", "producto", "descripcion", "name"])) || id;
  const categoria =
    toStr(firstValue(row, ["categoria", "rubro", "category", "descripcionCorta"])) ||
    "Otros";
  const subcategoria =
    toStr(firstValue(row, ["subcategoria", "subcategory", "sub_category"])) || "Otros";
  const precio = Math.max(
    0,
    toNumber(firstValue(row, ["precio_base", "precio", "precioRegular", "price"])),
  );
  const oferta = toBool(
    firstValue(row, ["oferta_carrusel", "oferta", "esPrecioOferta", "offer"]),
  );
  const destacado = toBool(
    firstValue(row, [
      "destacados",
      "Destacados",
      "destacado",
      "Featured",
      "featured",
      "oferta_carrusel",
    ]),
  );
  const imagen =
    toStr(firstValue(row, ["imagen_url", "imagen", "image_url", "imageUrl"])) || null;
  const marca = toStr(firstValue(row, ["marca", "brand"])) || null;
  const presentacion =
    toStr(firstValue(row, ["presentacion", "presentation"])) || null;
  const promoGroup = toStr(firstValue(row, ["promo_group", "grupo_promo"])) || null;
  const promoMin = toNumber(firstValue(row, ["promo_min_qty"]));
  const promoPrecio = toNumber(firstValue(row, ["promo_precio"]));

  const product = {
    id,
    nombre,
    categoria,
    subcategoria,
    precio,
    oferta,
    imagen,
    marca,
    presentacion,
    tags: parseTags(firstValue(row, ["tags", "etiquetas"])),
    destacado,
    promo_group: promoGroup,
  };

  if (promoMin > 0 && promoPrecio > 0) {
    product.dpc = { tramos: [{ min: promoMin, precio: promoPrecio }] };
  }

  const stockValue = firstValue(row, ["stock"]);
  if (stockValue !== "") product.stock = Math.max(0, Math.trunc(toNumber(stockValue)));

  return product;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function getSupabaseConfiguration() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const serviceRoleKey = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!baseUrl || !serviceRoleKey) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }

  return { baseUrl, serviceRoleKey };
}

async function loadProductsFromSupabase() {
  const { baseUrl, serviceRoleKey } = getSupabaseConfiguration();
  const products = [];
  let offset = 0;

  while (true) {
    const endpoint = new URL(`${baseUrl}/rest/v1/productos`);
    endpoint.searchParams.set(
      "select",
      [
        "id",
        "nombre",
        "categoria",
        "subcategoria",
        "precio_base",
        "oferta_carrusel",
        "destacados",
        "promo_group",
        "promo_min_qty",
        "promo_precio",
        "imagen_url",
        "marca",
        "presentacion",
        "tags",
        "activo",
        "prioridad_oferta",
      ].join(","),
    );
    endpoint.searchParams.set("activo", "eq.true");
    endpoint.searchParams.set("order", "prioridad_oferta.desc,nombre.asc");
    endpoint.searchParams.set("limit", String(SUPABASE_PAGE_SIZE));
    endpoint.searchParams.set("offset", String(offset));

    const response = await fetchWithTimeout(endpoint, {
      cache: "no-store",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Supabase respondió ${response.status}: ${text.slice(0, 700)}`);
    }

    const rows = JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error("Supabase devolvió un formato inesperado");

    for (const row of rows) {
      const product = rowToProduct(row);
      if (product) products.push(product);
    }

    if (rows.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  if (!products.length) {
    throw new Error("Supabase no devolvió productos activos");
  }

  return products;
}

async function loadProductsFromGoogleSheets() {
  const response = await fetchWithTimeout(CSV_URL, {
    cache: "no-store",
    headers: { Accept: "text/csv, text/plain, */*" },
  });
  const text = await response.text();

  if (!response.ok) throw new Error(`Google Sheets respondió ${response.status}`);

  const normalized = text.trim().toLowerCase();
  if (normalized.startsWith("<!doctype html") || normalized.includes("<html")) {
    throw new Error("Google Sheets devolvió HTML en lugar de CSV");
  }

  const products = rowsToObjects(parseCSV(text))
    .map(rowToProduct)
    .filter(Boolean);

  if (!products.length) throw new Error("Google Sheets no devolvió productos válidos");
  return products;
}

function saveInMemoryFallback(products, source) {
  inMemoryFallback = {
    products,
    updatedAt: Date.now(),
    source,
  };
}

function sendCatalogResponse(
  res,
  { products, source, degraded = false, fallbackFrom = null, warning = null },
) {
  setCatalogCacheHeaders(res);

  return res.status(200).json({
    products,
    updatedAt: Date.now(),
    degraded,
    source,
    ...(fallbackFrom ? { fallbackFrom } : {}),
    ...(warning ? { warning } : {}),
  });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const products = await loadProductsFromSupabase();
    saveInMemoryFallback(products, "supabase");

    return sendCatalogResponse(res, {
      products,
      source: "supabase",
    });
  } catch (supabaseError) {
    console.error("[catalog] Falló Supabase:", supabaseError);

    try {
      const products = await loadProductsFromGoogleSheets();
      saveInMemoryFallback(products, "google_sheets");

      return sendCatalogResponse(res, {
        products,
        source: "google_sheets",
        degraded: true,
        fallbackFrom: "supabase",
        warning: "Supabase no estuvo disponible. Se cargó el catálogo desde Google Sheets.",
      });
    } catch (googleSheetsError) {
      console.error("[catalog] Falló Google Sheets:", googleSheetsError);

      if (inMemoryFallback?.products?.length) {
        return sendCatalogResponse(res, {
          products: inMemoryFallback.products,
          source: inMemoryFallback.source || "memory",
          degraded: true,
          fallbackFrom: "supabase_and_google_sheets",
          warning: "Se devolvió la última copia disponible del catálogo.",
        });
      }

      res.setHeader("Cache-Control", "no-store");
      return res.status(503).json({
        error: "No se pudo cargar el catálogo",
        degraded: true,
        sources: {
          supabase: String(supabaseError?.message || supabaseError),
          google_sheets: String(googleSheetsError?.message || googleSheetsError),
        },
      });
    }
  }
}
