// data.js — versión FINAL y defensiva para GitHub Pages
// ✅ Soporta:
// - JSON local (./products.json)
// - CSV publicado desde Google Sheets (output=csv)
// - Diagnósticos claros cuando algo falla

// =======================
// CONFIG
// =======================

// ✅ Por defecto, JSON local:
export const PRODUCTS_URL = "./products.json";

// ✅ Si querés usar Google Sheets, pegá acá tu link CSV publicado:
// export const PRODUCTS_URL = "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=YYYY&single=true&output=csv";

// =======================
// HELPERS (GENERALES)
// =======================

function isCSVUrl(url) {
  const u = String(url || "").toLowerCase();
  return u.includes("output=csv") || u.endsWith(".csv");
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;

  let s = String(v).trim();
  if (!s) return 0;

  // soporta "$ 1.234,56" y "1234.56"
  s = s.replace(/\$/g, "").trim();
  s = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "si" || s === "sí" || s === "yes";
}

function safeText(v) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

function normKey(k) {
  return String(k || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function toTags(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;

  // recomendado: tags separadas por |  (ej: "cola|sin azúcar|retornable")
  const parts = s
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

  return parts.length ? parts : null;
}

// =======================
// CSV PARSER (ROBUSTO)
// =======================

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    // escape "" dentro de comillas
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
      if (ch === "\r" && next === "\n") i++; // CRLF

      row.push(cur);
      cur = "";

      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }

    cur += ch;
  }

  row.push(cur);
  if (row.some((c) => String(c).trim() !== "")) rows.push(row);

  return rows;
}

// =======================
// CONVERSIÓN CSV → products[]
// =======================

/**
 * Convierte el CSV a array de productos con el formato de tu web:
 * { id, nombre, categoria, subcategoria, precio, oferta, imagen, marca, presentacion, tags, dpc }
 *
 * Columnas esperadas (recomendado):
 * id, nombre, categoria, subcategoria, precio_base, oferta_carrusel, promo_min_qty, promo_precio, promo_texto, imagen_url, marca, presentacion, tags, activo
 */
function csvToProducts(csvText) {
  const rows = parseCSV(csvText);
  if (!rows.length) return [];

  const header = rows[0].map(normKey);
  const dataRows = rows.slice(1);

  const products = [];

  for (const r of dataRows) {
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = r[i] ?? "";
    }

    const id = String(obj.id ?? "").trim();
    if (!id) continue;

    const activo = obj.activo === "" ? true : toBool(obj.activo);
    if (!activo) continue;

    const nombre = safeText(obj.nombre) ?? id;
    const categoria = safeText(obj.categoria) ?? "Otros";
    const subcategoria = safeText(obj.subcategoria) ?? "Otros";

    const precioBase = toNumber(obj.precio_base);
    const ofertaCarrusel = toBool(obj.oferta_carrusel);

    const promoMin = toNumber(obj.promo_min_qty);
    const promoPrecio = toNumber(obj.promo_precio);
    const promoTexto = safeText(obj.promo_texto);

    // ✅ “Sacar el 999999”: si viene 999999, lo ignoramos
    const promoPrecioOk = promoPrecio > 0 && promoPrecio !== 999999;

    const imagen = safeText(obj.imagen_url ?? obj.imagen);
    const marca = safeText(obj.marca);
    const presentacion = safeText(obj.presentacion);
    const tags = toTags(obj.tags);

    const p = {
      id,
      nombre,
      categoria,
      subcategoria,
      precio: precioBase,
      oferta: ofertaCarrusel === true,
      imagen,
      marca,
      presentacion,
      tags,
    };

    // Promo por cantidad en el formato que tu UI ya lee: product.dpc.tramos[{min,precio}]
    if (promoMin > 0 && promoPrecioOk) {
      p.dpc = { tramos: [{ min: promoMin, precio: promoPrecio }] };
    }

    // Si querés mostrar texto fijo (cuando no querés depender del cálculo)
    // tu ui.js ya arma el texto con min/precio, pero esto lo deja disponible si lo usás luego.
    if (promoTexto) p.promo_texto = promoTexto;

    products.push(p);
  }

  return products;
}

// =======================
// FETCH PRINCIPAL
// =======================

/**
 * Carga el catálogo de productos.
 * - Detecta 404
 * - Detecta si la respuesta NO coincide (JSON vs CSV)
 * - Evita errores silenciosos
 */
export async function fetchProducts() {
  let res;

  try {
    res = await fetch(PRODUCTS_URL, {
      cache: "no-store",
      headers: {
        // pedimos texto porque puede ser CSV o JSON
        Accept: "text/plain,application/json",
      },
    });
  } catch (err) {
    throw new Error(
      "No se pudo conectar para cargar productos. Verificá conexión o URL."
    );
  }

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Error HTTP ${res.status} al cargar productos.`);
  }

  // Decidir modo por URL (más confiable en GitHub Pages)
  const csvMode = isCSVUrl(PRODUCTS_URL);

  if (csvMode) {
    // ✅ CSV desde Sheets
    try {
      const products = csvToProducts(text);

      if (!Array.isArray(products)) {
        throw new Error("El CSV se leyó pero no devolvió una lista válida.");
      }

      if (products.length === 0) {
        throw new Error(
          "El CSV cargó pero quedó vacío. Revisá que la hoja tenga filas y columna 'id'."
        );
      }

      return products;
    } catch (err) {
      throw new Error(
        "No se pudo interpretar el CSV de Google Sheets. Revisá que esté publicado como CSV y que tenga encabezados correctos (id, nombre, categoria...)."
      );
    }
  }

  // ✅ JSON (modo tradicional)
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // Si el usuario apuntó a JSON pero recibió CSV (o HTML), lo avisamos claro:
    if (text.includes(",") && text.toLowerCase().includes("id,")) {
      throw new Error(
        "La URL devolvió CSV, pero el sitio esperaba JSON. Si estás usando Google Sheets, cambiá PRODUCTS_URL al link que termina en output=csv."
      );
    }

    throw new Error(
      "products.json existe pero NO es JSON válido. Revisá comas, llaves o comillas."
    );
  }

  if (!Array.isArray(data)) {
    throw new Error("products.json es JSON válido pero NO es un array de productos.");
  }

  return data;
}
