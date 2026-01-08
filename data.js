// data.js — versión estable para GitHub Pages

const BASE = "/mayorista-makabra/";

export const PRODUCTS_URL = BASE + "data/products.json";

export async function fetchProducts() {
  const res = await fetch(PRODUCTS_URL, { cache: "no-store" });

  if (!res.ok) {
    throw new Error("No se pudo cargar products.json (" + res.status + ")");
  }

  return await res.json();
}
