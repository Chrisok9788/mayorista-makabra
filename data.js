// data.js — versión final y correcta para GitHub Pages

export const PRODUCTS_URL = "./products.json";

/**
 * Carga el catálogo desde products.json
 * (Funciona en GitHub Pages usando ruta relativa)
 */
export async function fetchProducts() {
  const res = await fetch(PRODUCTS_URL, { cache: "no-store" });

  if (!res.ok) {
    throw new Error("No se pudo cargar products.json (" + res.status + ")");
  }

  return await res.json();
}
