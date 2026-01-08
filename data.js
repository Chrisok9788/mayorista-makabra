// data.js
// Carga de productos desde products.json compatible con GitHub Pages

const BASE =
  typeof import.meta !== "undefined" &&
  import.meta.env &&
  import.meta.env.BASE_URL
    ? import.meta.env.BASE_URL
    : "/";

export const PRODUCTS_URL = `${BASE}products.json`;

export async function fetchProducts() {
  const res = await fetch(PRODUCTS_URL);
  if (!res.ok) {
    throw new Error(`No se pudo cargar products.json (${res.status})`);
  }
  return await res.json();
}
