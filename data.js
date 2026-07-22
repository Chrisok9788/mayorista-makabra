// data.js — catálogo con API Vercel, respaldos y caché local

export const PRODUCTS_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJAgesFM5B0OTnVSvcOxrtC4VlI1ijay6erm7XnX8zjRtwUnbX-M0_4yXxRhcairW01hFOjoKQHW7t/pub?gid=1128238455&single=true&output=csv";

const SOURCES = [
  { url: "/api/catalog", type: "json", timeoutMs: 9000 },
  { url: "/products.json", type: "json", timeoutMs: 5000 },
  { url: PRODUCTS_URL, type: "csv", timeoutMs: 10000 },
];

const CATALOG_CACHE_KEY = "catalog_cache_v3";
const LOCAL_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

function toStr(value) {
  return String(value ?? "").trim();
}

function toBool(value) {
  if (value === true) return true;
  if (value === false) return false;

  const normalized = toStr(value).toLowerCase();
  return ["true", "verdadero", "1", "si", "sí", "yes"].includes(normalized);
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
  if (Array.isArray(value)) {
    return value.map(toStr).filter(Boolean);
  }

  const text = toStr(value);
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(toStr).filter(Boolean);
    } catch {
      // Continúa con el formato separado por coma o punto y coma.
    }
  }

  return text
    .split(/[;,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
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
      method: "GET",
      cache: "default",
      headers: {
        Accept: "application/json, text/csv, text/plain, */*",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

function normalizeProduct(item) {
  const id = toStr(
    firstValue(item, ["id", "ID", "codigoInterno", "scanntech_id", "scanntechId"]),
  );
  if (!id) return null;

  const nombre = toStr(firstValue(item, ["nombre", "producto", "descripcion", "name"])) || id;
  const categoria =
    toStr(firstValue(item, ["categoria", "rubro", "category", "descripcionCorta"])) ||
    "Otros";
  const subcategoria =
    toStr(firstValue(item, ["subcategoria", "subcategory", "sub_category"])) || "Otros";
  const precio = toNumber(
    firstValue(item, ["precio", "precio_base", "precioRegular", "price", "precioBase"]),
  );
  const oferta = toBool(
    firstValue(item, ["oferta", "oferta_carrusel", "esPrecioOferta", "offer"]),
  );
  const destacado = toBool(
    firstValue(item, [
      "destacado",
      "destacados",
      "Destacados",
      "DESTACADOS",
      "Featured",
      "featured",
      "oferta_carrusel",
    ]),
  );
  const imagen =
    toStr(firstValue(item, ["imagen", "imagen_url", "image_url", "imageUrl", "img"])) || null;
  const marca = toStr(firstValue(item, ["marca", "brand"])) || null;
  const presentacion =
    toStr(firstValue(item, ["presentacion", "presentation"])) || null;
  const tags = parseTags(firstValue(item, ["tags", "etiquetas"]));
  const promoGroup =
    toStr(
      firstValue(item, [
        "promo_group",
        "PROMO_GROUP",
        "promo group",
        "Promo Group",
        "promogroup",
        "PromoGroup",
        "grupo_promo",
        "GrupoPromo",
        "grupo",
        "Grupo",
      ]),
    ) || null;

  const promoMin = toNumber(firstValue(item, ["promo_min_qty"]));
  const promoPrecio = toNumber(firstValue(item, ["promo_precio"]));
  const dpc =
    item?.dpc ||
    (promoMin > 0 && promoPrecio > 0
      ? { tramos: [{ min: promoMin, precio: promoPrecio }] }
      : undefined);

  const product = {
    id,
    nombre,
    categoria,
    subcategoria,
    precio: Math.max(0, precio),
    oferta,
    imagen,
    marca,
    presentacion,
    tags,
    destacado,
    promo_group: promoGroup,
  };

  if (dpc) product.dpc = dpc;

  const stockValue = firstValue(item, ["stock", "inventory"]);
  if (stockValue !== "") product.stock = Math.max(0, Math.trunc(toNumber(stockValue)));

  return product;
}

function extractList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.products)) return payload.products;
  return [];
}

function readCatalogCache() {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.products) || !parsed.products.length) return null;

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
      }),
    );
  } catch {
    // El catálogo sigue funcionando aunque el almacenamiento local esté lleno.
  }
}

function productSignature(products) {
  if (!Array.isArray(products) || !products.length) return "0";

  let hash = 0;
  for (const product of products) {
    const text = [
      product.id,
      product.nombre,
      product.categoria,
      product.subcategoria,
      product.precio,
      product.oferta,
      product.imagen,
      product.destacado,
      product.promo_group,
      product.stock,
      JSON.stringify(product.dpc || null),
    ].join("|");

    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) | 0;
    }
  }

  return `${products.length}:${hash}`;
}

async function fetchFromSource(source) {
  const base = getApiBase();
  const url = source.url.startsWith("/api/") && base ? `${base}${source.url}` : source.url;

  try {
    const response = await fetchWithTimeout(url, source.timeoutMs);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    let payload;
    let degradedFromApi = false;
    let updatedAtFromApi = null;

    if (source.type === "json") {
      payload = await response.json();
      degradedFromApi = Boolean(payload?.degraded);
      updatedAtFromApi = payload?.updatedAt ? Number(payload.updatedAt) : null;
    } else {
      const text = await response.text();
      if (text.trim().toLowerCase().startsWith("<!doctype html") || text.includes("<html")) {
        throw new Error("La fuente CSV devolvió HTML");
      }
      payload = rowsToObjects(parseCSV(text));
    }

    const rows = extractList(payload);
    if (!rows.length) throw new Error("Fuente vacía o formato inválido");

    const products = [];
    let rejectedCount = 0;

    for (const row of rows) {
      const product = normalizeProduct(row);
      if (product) products.push(product);
      else rejectedCount += 1;
    }

    if (!products.length) throw new Error("No se encontraron productos válidos");

    return {
      products,
      updatedAt: updatedAtFromApi || Date.now(),
      source: source.url,
      degraded: degradedFromApi || source.url !== "/api/catalog",
      rejectedCount,
    };
  } catch (error) {
    console.warn(`[Catalog] Falló fuente ${source.url}: ${error?.message || error}`);
    return null;
  }
}

export async function loadProductsWithCache() {
  const cached = readCatalogCache();
  const cacheAge = cached?.updatedAt ? Date.now() - cached.updatedAt : Infinity;
  const cacheIsFresh =
    Boolean(cached?.products?.length) &&
    cacheAge >= 0 &&
    cacheAge < LOCAL_CACHE_MAX_AGE_MS;

  if (cacheIsFresh) {
    const result = {
      changed: false,
      products: cached.products,
      updatedAt: cached.updatedAt,
      source: cached.source,
      degraded: cached.degraded,
      rejectedCount: cached.rejectedCount,
    };

    return {
      products: cached.products,
      fromCache: true,
      lastUpdated: cached.updatedAt,
      source: cached.source,
      degraded: cached.degraded,
      rejectedCount: cached.rejectedCount,
      updatePromise: Promise.resolve(result),
    };
  }

  const cachedSignature = cached ? productSignature(cached.products) : "";

  const updatePromise = (async () => {
    for (const source of SOURCES) {
      const fresh = await fetchFromSource(source);
      if (!fresh?.products?.length) continue;

      const changed = !cached || cachedSignature !== productSignature(fresh.products);
      writeCatalogCache(fresh);

      return {
        changed,
        products: fresh.products,
        updatedAt: fresh.updatedAt,
        source: fresh.source,
        degraded: fresh.degraded,
        rejectedCount: fresh.rejectedCount,
      };
    }

    return {
      error: "No se pudo actualizar el catálogo",
      products: cached?.products || [],
      updatedAt: cached?.updatedAt || Date.now(),
      source: cached?.source || "none",
      degraded: true,
      rejectedCount: cached?.rejectedCount || 0,
    };
  })();

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

  const first = await updatePromise;
  if (first.error || !first.products?.length) {
    throw new Error(first.error || "No se pudo cargar el catálogo");
  }

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
