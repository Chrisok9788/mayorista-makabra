import Papa from "papaparse";

export const config = {
  runtime: "edge",
};

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseBoolean(value) {
  const normalized = normalizeText(value).toLowerCase();
  return ["1", "true", "verdadero", "si", "sí", "yes"].includes(normalized);
}

function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const raw = normalizeText(value);
  if (!raw) return 0;

  const sanitized = raw
    .replace(/\$/g, "")
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,/g, ".");

  const parsed = Number.parseFloat(sanitized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanImagePath(value) {
  const url = normalizeText(value);
  if (!url) return "";

  const withoutSpaces = url.replace(/\s+/g, "%20");
  const withoutDuplicateSlashes = withoutSpaces.replace(/([^:]\/)\/+?/g, "$1");
  return withoutDuplicateSlashes;
}

function buildSearchKey(product) {
  return [product.id, product.nombre, product.marca, product.categoria, product.subcategoria]
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeRow(row) {
  const id = normalizeText(row.id);
  if (!id) return null;

  const nombre = normalizeText(row.nombre) || id;
  const categoria = normalizeText(row.categoria) || "Sin categoría";
  const subcategoria = normalizeText(row.subcategoria);
  const marca = normalizeText(row.marca);

  const product = {
    id,
    nombre,
    categoria,
    subcategoria,
    marca,
    precio: parsePrice(row.precio_base ?? row.precio ?? row.price),
    activo: row.activo === "" ? true : parseBoolean(row.activo),
    oferta_carrusel: parseBoolean(row.oferta_carrusel),
    imagen: cleanImagePath(row.imagen_url ?? row.imagen ?? row.image),
  };

  if (!product.activo) return null;

  // Corrección: el searchKey se calcula luego de normalizar todos los campos para evitar vacíos inconsistentes.
  product.searchKey = buildSearchKey(product);
  return product;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method Not Allowed" }, 405);
  }

  try {
    const csvUrl = process.env.CATALOG_CSV_URL;
    if (!csvUrl) {
      return jsonResponse({ error: "Missing CATALOG_CSV_URL" }, 500);
    }

    const csvResponse = await fetch(csvUrl, {
      method: "GET",
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    });

    if (!csvResponse.ok) {
      return jsonResponse({ error: `CSV fetch failed (${csvResponse.status})` }, 502);
    }

    const csvText = await csvResponse.text();
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => normalizeText(header).toLowerCase(),
    });

    if (parsed.errors.length > 0) {
      return jsonResponse({ error: "Invalid CSV format", details: parsed.errors[0]?.message ?? "Unknown" }, 400);
    }

    const products = parsed.data.map(normalizeRow).filter(Boolean);

    return jsonResponse({
      updatedAt: new Date().toISOString(),
      products,
    });
  } catch (error) {
    return jsonResponse({ error: "Failed to load catalog", message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}
