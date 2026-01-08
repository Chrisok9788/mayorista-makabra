/*
 * Módulo para cargar productos desde el archivo JSON.
 *
 * Se exporta la constante PRODUCTS_URL, que construye
 * dinámicamente la ruta al JSON teniendo en cuenta la base
 * configurada en Vite. También se expone la función
 * fetchProducts() para obtener la lista de productos desde
 * ese recurso.
 */

// Construimos la ruta al JSON de productos. Si el proyecto se
// publica en GitHub Pages u otra ruta base, import.meta.env.BASE_URL
// contendrá el valor adecuado, de lo contrario se usa '/'.
// Determinamos la ruta base. En entornos como Vite,
// import.meta.env.BASE_URL estará definida. En otros contextos (p. ej. abrir
// el HTML directamente desde el sistema de archivos), evitamos errores
// comprobando su existencia.
const _base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
  ? import.meta.env.BASE_URL
  : '/';

// Exportamos la ruta completa al JSON de productos utilizando la base calculada.
export const PRODUCTS_URL = `${_base}data/products.json`;

/**
 * Obtiene los productos desde el JSON remoto.
 *
 * @returns {Promise<Array>} Una promesa que se resuelve con la lista de productos.
 * @throws {Error} si el recurso no puede cargarse.
 */
export async function fetchProducts() {
  const res = await fetch(PRODUCTS_URL);
  if (!res.ok) throw new Error('No se pudo cargar el catálogo');
  return await res.json();
}