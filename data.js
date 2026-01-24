// data.js — versión FINAL y defensiva para GitHub Pages
// Sirve tanto para JSON local como para API remota

export const PRODUCTS_URL = "./products.json";
// Si en el futuro usás API:
// export const PRODUCTS_URL = "https://tu-api.com/products";

/**
 * Carga el catálogo de productos.
 * - Detecta 404
 * - Detecta si la respuesta NO es JSON
 * - Evita errores silenciosos
 */
export async function fetchProducts() {
  let res;

  try {
    res = await fetch(PRODUCTS_URL, {
      cache: "no-store",
      headers: {
        "Accept": "application/json"
      }
    });
  } catch (err) {
    throw new Error(
      "No se pudo conectar para cargar productos. Verificá conexión o URL."
    );
  }

  // Leemos como texto primero para poder diagnosticar errores
  const text = await res.text();

  // Error HTTP (404, 500, etc.)
  if (!res.ok) {
    throw new Error(
      `Error HTTP ${res.status} al cargar products.json`
    );
  }

  // Intentamos parsear JSON
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(
      "products.json existe pero NO es JSON válido. Revisá comas, llaves o comillas."
    );
  }

  // Validación mínima del contenido
  if (!Array.isArray(data)) {
    throw new Error(
      "products.json es JSON válido pero NO es un array de productos."
    );
  }

  return data;
}
