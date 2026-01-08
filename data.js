/*
 * Módulo para cargar productos desde el archivo JSON.
 *
 * Construye correctamente la ruta al archivo products.json
 * tanto para GitHub Pages como para ejecución local.
 */

// Determinar la base correcta (GitHub Pages / entorno normal)
const BASE_URL =
  (typeof import.meta !== 'undefined' &&
    import.meta.env &&
    import.meta.env.BASE_URL)
    ? import.meta.env.BASE_URL
    : './';

// Ruta FINAL y correcta al JSON de productos
export const PRODUCTS_URL = `${BASE_URL}products.json`;

/**
 * Obtiene los productos desde el JSON.
 * @returns {Promise<Array>}
 */
export async function fetchProducts() {
  const response = await fetch(PRODUCTS_URL);

  if (!response.ok) {
    throw new Error(`No se pudo cargar el catálogo desde ${PRODUCTS_URL}`);
  }

  return await response.json();
}
