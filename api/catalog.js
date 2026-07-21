// api/catalog.js

export const config = {
  runtime: "nodejs",
};

const CSV_URL =
  process.env.CSV_URL ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJAgesFM5B0OTnVSvcOxrtC4VlI1ijay6erm7XnX8zjRtwUnbX-M0_4yXxRhcairW01hFOjoKQHW7t/pub?gid=1128238455&single=true&output=csv";

const DEFAULT_TIMEOUT_MS = Number(
  process.env.CATALOG_TIMEOUT_MS || 12000,
);

const SUPABASE_PAGE_SIZE = 1000;

const EDGE_CACHE_CONTROL =
  "public, s-maxage=300, stale-while-revalidate=1800, stale-if-error=86400";

/*
 * Esta caché puede sobrevivir entre solicitudes mientras la misma
 * instancia serverless siga activa. No reemplaza una caché persistente,
 * pero permite responder si Supabase y Google Sheets fallan temporalmente.
 */
let inMemoryFallback = null;

function toStr(value) {
  return String(value ?? "").trim();
}

function toBool(value) {
  if (value === true) return true;
  if (value === false) return false;

  const normalized = toStr(value).toLowerCase();

  if (!normalized) return false;

  if (
    normalized === "true" ||
    normalized === "verdadero" ||
    normalized === "1" ||
    normalized === "si" ||
    normalized === "sí" ||
    normalized === "yes"
  ) {
    return true;
  }

  return false;
}

function toNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const normalized = toStr(value)
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");

  const number = Number(normalized);

  return Number.isFinite(number) ? number : 0;
}

function parseTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => toStr(item))
      .filter(Boolean);
  }

  const text = toStr(value);

  if (!text) return [];

  /*
   * También soporta etiquetas guardadas como JSON:
   * ["bebidas", "refresco"]
   */
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text);

      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => toStr(item))
          .filter(Boolean);
      }
    } catch {
      // Si no es JSON válido, continúa con la separación normal.
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
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (
      character === '"' &&
      inQuotes &&
      nextCharacter === '"'
    ) {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if (
      (character === "\n" || character === "\r") &&
      !inQuotes
    ) {
      if (
        character === "\r" &&
        nextCharacter === "\n"
      ) {
        index += 1;
      }

      row.push(current);
      rows.push(row);

      row = [];
      current = "";

      continue;
    }

    current += character;
  }

  row.push(current);
  rows.push(row);

  return rows.filter((currentRow) =>
    currentRow.some((cell) => toStr(cell) !== ""),
  );
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return [];
  }

  const headers = rows[0].map((header) =>
    toStr(header),
  );

  const objects = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const object = {};

    for (
      let columnIndex = 0;
      columnIndex < headers.length;
      columnIndex += 1
    ) {
      const key = headers[columnIndex];

      if (!key) continue;

      object[key] = row[columnIndex] ?? "";
    }

    objects.push(object);
  }

  return objects;
}

function getDestacadosValue(row) {
  return (
    row.Destacados ??
    row.destacados ??
    row.destacado ??
    row.DESTACADOS ??
    row["Destacados "] ??
    row["destacados "] ??
    row.Featured ??
    row.featured
  );
}

function getPromoGroupValue(row) {
  return (
    row.promo_group ??
    row.PROMO_GROUP ??
    row["promo group"] ??
    row["Promo Group"] ??
    row.promogroup ??
    row.PromoGroup ??
    row.grupo_promo ??
    row.GrupoPromo ??
    row.grupo ??
    row.Grupo
  );
}

/*
 * Convierte tanto una fila de Google Sheets como una fila de Supabase
 * al formato que ya consume la página.
 */
function rowToProduct(row) {
  const id = toStr(row.id);

  if (!id) return null;

  /*
   * En Google Sheets, una celda vacía significa activo.
   * En Supabase, activo normalmente será true o false.
   */
  const activo =
    row.activo === undefined ||
    row.activo === null ||
    row.activo === ""
      ? true
      : toBool(row.activo);

  if (!activo) return null;

  const nombre = toStr(row.nombre);
  const categoria = toStr(row.categoria);
  const subcategoria = toStr(row.subcategoria);

  const precioBase = toNumber(
    row.precio_base ?? row.precio,
  );

  const imagen =
    toStr(
      row.imagen_url ??
        row.imagen,
    ) || null;

  const marca = toStr(row.marca) || null;
  const presentacion =
    toStr(row.presentacion) || null;

  const tags = parseTags(row.tags);

  const ofertaCarrusel = toBool(
    row.oferta_carrusel ?? row.oferta,
  );

  const destacado = toBool(
    getDestacadosValue(row),
  );

  const promoGroup =
    toStr(getPromoGroupValue(row)) || null;

  const promoMin = toNumber(
    row.promo_min_qty,
  );

  const promoPrecio = toNumber(
    row.promo_precio,
  );

  const dpc =
    promoMin > 0 && promoPrecio > 0
      ? {
          tramos: [
            {
              min: Math.trunc(promoMin),
              precio: promoPrecio,
            },
          ],
        }
      : undefined;

  const product = {
    id,
    nombre: nombre || id,
    categoria: categoria || "Otros",
    subcategoria: subcategoria || "Otros",
    precio: precioBase > 0 ? precioBase : 0,
    oferta: ofertaCarrusel,
    imagen,
    marca,
    presentacion,
    tags,
    destacado,
    promo_group: promoGroup,
  };

  if (dpc) {
    product.dpc = dpc;
  }

  /*
   * Se conserva por compatibilidad futura,
   * aunque actualmente no estés usando stock.
   */
  if (
    row.stock !== undefined &&
    row.stock !== null &&
    row.stock !== ""
  ) {
    product.stock = toNumber(row.stock);
  }

  return product;
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function validateSupabaseConfiguration() {
  const baseUrl = toStr(
    process.env.SUPABASE_URL,
  );

  const serviceRoleKey = toStr(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!baseUrl || !serviceRoleKey) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    serviceRoleKey,
  };
}

async function loadProductsFromSupabase() {
  const {
    baseUrl,
    serviceRoleKey,
  } = validateSupabaseConfiguration();

  const products = [];

  let offset = 0;

  while (true) {
    const endpoint = new URL(
      `${baseUrl}/rest/v1/productos`,
    );

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
        "stock",
      ].join(","),
    );

    endpoint.searchParams.set(
      "activo",
      "eq.true",
    );

    endpoint.searchParams.set(
      "order",
      "prioridad_oferta.desc,nombre.asc",
    );

    endpoint.searchParams.set(
      "limit",
      String(SUPABASE_PAGE_SIZE),
    );

    endpoint.searchParams.set(
      "offset",
      String(offset),
    );

    const response = await fetchWithTimeout(
      endpoint,
      {
        cache: "no-store",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/json",
        },
      },
    );

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Supabase respondió ${response.status}: ${text.slice(
          0,
          700,
        )}`,
      );
    }

    let page;

    try {
      page = JSON.parse(text);
    } catch {
      throw new Error(
        "Supabase devolvió una respuesta que no es JSON válido.",
      );
    }

    if (!Array.isArray(page)) {
      throw new Error(
        "Supabase devolvió un formato inesperado.",
      );
    }

    for (const row of page) {
      const product = rowToProduct(row);

      if (product) {
        products.push(product);
      }
    }

    if (page.length < SUPABASE_PAGE_SIZE) {
      break;
    }

    offset += SUPABASE_PAGE_SIZE;
  }

  if (!products.length) {
    throw new Error(
      "Supabase respondió correctamente, pero no devolvió productos activos.",
    );
  }

  return products;
}

async function loadProductsFromGoogleSheets() {
  const response = await fetchWithTimeout(
    CSV_URL,
    {
      cache: "no-store",
      headers: {
        Accept:
          "text/csv, text/plain, */*",
      },
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Google Sheets respondió ${response.status}.`,
    );
  }

  const normalizedText = text
    .trim()
    .toLowerCase();

  if (
    normalizedText.startsWith(
      "<!doctype html",
    ) ||
    normalizedText.includes("<html")
  ) {
    throw new Error(
      "El enlace de Google Sheets devolvió HTML en lugar de CSV.",
    );
  }

  const rows = parseCSV(text);
  const objects = rowsToObjects(rows);

  const products = [];

  for (const row of objects) {
    const product = rowToProduct(row);

    if (product) {
      products.push(product);
    }
  }

  if (!products.length) {
    throw new Error(
      "Google Sheets cargó, pero no se generaron productos. Revisá la columna id.",
    );
  }

  return products;
}

function saveInMemoryFallback(
  products,
  source,
) {
  inMemoryFallback = {
    products,
    updatedAt: Date.now(),
    source,
  };
}

function sendCatalogResponse(
  res,
  {
    products,
    source,
    degraded = false,
    fallbackFrom = null,
    warning = null,
  },
) {
  res.setHeader(
    "Cache-Control",
    EDGE_CACHE_CONTROL,
  );

  return res.status(200).json({
    products,
    updatedAt: Date.now(),
    degraded,
    source,
    ...(fallbackFrom
      ? { fallbackFrom }
      : {}),
    ...(warning ? { warning } : {}),
  });
}

export default async function handler(
  req,
  res,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Method Not Allowed",
    });
  }

  /*
   * 1. Fuente principal: Supabase
   */
  try {
    const products =
      await loadProductsFromSupabase();

    saveInMemoryFallback(
      products,
      "supabase",
    );

    return sendCatalogResponse(res, {
      products,
      source: "supabase",
      degraded: false,
    });
  } catch (supabaseError) {
    console.error(
      "[catalog] Falló Supabase:",
      supabaseError,
    );

    /*
     * 2. Respaldo automático: Google Sheets
     */
    try {
      const products =
        await loadProductsFromGoogleSheets();

      saveInMemoryFallback(
        products,
        "google_sheets",
      );

      return sendCatalogResponse(res, {
        products,
        source: "google_sheets",
        degraded: true,
        fallbackFrom: "supabase",
        warning:
          "Supabase no estuvo disponible. Se cargó el catálogo desde Google Sheets.",
      });
    } catch (googleSheetsError) {
      console.error(
        "[catalog] Falló Google Sheets:",
        googleSheetsError,
      );

      /*
       * 3. Último respaldo: copia guardada en memoria
       */
      if (
        inMemoryFallback?.products?.length
      ) {
        return sendCatalogResponse(res, {
          products:
            inMemoryFallback.products,
          source:
            inMemoryFallback.source ||
            "memory",
          degraded: true,
          fallbackFrom:
            "supabase_and_google_sheets",
          warning:
            "No se pudo actualizar el catálogo. Se devolvió la última copia disponible.",
        });
      }

      res.setHeader(
        "Cache-Control",
        EDGE_CACHE_CONTROL,
      );

      const supabaseMessage =
        supabaseError?.name ===
        "AbortError"
          ? "Supabase agotó el tiempo de espera."
          : toStr(
              supabaseError?.message,
            ) ||
            "No se pudo cargar Supabase.";

      const sheetsMessage =
        googleSheetsError?.name ===
        "AbortError"
          ? "Google Sheets agotó el tiempo de espera."
          : toStr(
              googleSheetsError?.message,
            ) ||
            "No se pudo cargar Google Sheets.";

      return res.status(503).json({
        error:
          "No se pudo cargar el catálogo.",
        degraded: true,
        sources: {
          supabase: supabaseMessage,
          google_sheets: sheetsMessage,
        },
      });
    }
  }
}
