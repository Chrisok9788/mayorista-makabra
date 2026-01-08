const BASE =
  typeof import.meta !== "undefined" &&
  import.meta.env &&
  import.meta.env.BASE_URL
    ? import.meta.env.BASE_URL
    : "/";

export const PRODUCTS_URL = `${BASE}data/products.json`;

export async function fetchProducts() {
  const res = await fetch(PRODUCTS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo cargar catálogo (${res.status})`);
  return await res.json();
}
