/*
 * Módulo para manejar el carrito de compras: carga, guarda y
 * operaciones sobre los productos almacenados. El carrito se
 * persiste en localStorage para mantener el estado entre
 * recargas.
 */

// Estructura interna del carrito.
// Clave: productId (o nombre viejo) | Valor: cantidad
let cart = {};
const CART_KEY = "cart";

/**
 * Carga el carrito desde localStorage.
 */
export function loadCart() {
  try {
    const stored = localStorage.getItem(CART_KEY);
    cart = stored ? JSON.parse(stored) : {};
  } catch {
    cart = {};
  }

  // Limpieza mínima
  for (const k of Object.keys(cart)) {
    const qty = Number(cart[k]);
    const key = String(k ?? "").trim();

    if (!key || !Number.isFinite(qty) || qty < 1) {
      delete cart[k];
    } else if (key !== k) {
      // normaliza espacios
      delete cart[k];
      cart[key] = qty;
    }
  }

  saveCart();
}

/**
 * Guarda el carrito en localStorage.
 */
export function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

/**
 * Devuelve una copia del carrito actual.
 */
export function getCart() {
  return { ...cart };
}

/**
 * Devuelve el total de ítems (sumatoria de cantidades).
 */
export function totalItems() {
  return Object.values(cart).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

/**
 * Agrega una unidad de un producto al carrito.
 */
export function addItem(productKey) {
  const key = String(productKey ?? "").trim();
  if (!key) return;

  cart[key] = (cart[key] || 0) + 1;
  saveCart();
}

/**
 * Actualiza la cantidad de un producto.
 * - Si qty < 1 elimina el producto.
 */
export function updateItem(productKey, qty) {
  const key = String(productKey ?? "").trim();
  const n = Number(qty);

  if (!key) return;

  if (!Number.isFinite(n) || n < 1) {
    delete cart[key];
  } else {
    cart[key] = n;
  }
  saveCart();
}

/**
 * Elimina un producto del carrito.
 */
export function removeItem(productKey) {
  const key = String(productKey ?? "").trim();
  if (!key) return;

  delete cart[key];
  saveCart();
}

/**
 * Vacía completamente el carrito.
 */
export function clearCart() {
  cart = {};
  saveCart();
}

/**
 * Convierte precio a número (defensivo).
 */
function toNumberPrice(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;

  let s = String(v).trim();
  s = s.replace(/\$/g, "").trim();
  s = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Calcula el MONTO TOTAL del carrito en base a los productos.
 * - Ignora productos con precio 0 (Consultar)
 * - COMPATIBLE con carritos viejos: si la key no matchea con p.id,
 *   intenta matchear contra p.nombre.
 *
 * @param {Object} cartObj Carrito (key -> cantidad)
 * @param {Array} products Lista de productos
 * @returns {number} Total en pesos
 */
export function totalAmount(cartObj, products) {
  if (!cartObj || typeof cartObj !== "object") return 0;
  if (!Array.isArray(products) || products.length === 0) return 0;

  // Índices para encontrar por id o por nombre
  const byId = new Map();
  const byNombre = new Map();

  for (const p of products) {
    const id = String(p.id ?? "").trim();
    const nombre = String(p.nombre ?? "").trim();

    if (id) byId.set(id, p);
    if (nombre) byNombre.set(nombre, p);
  }

  let total = 0;

  for (const rawKey in cartObj) {
    const key = String(rawKey ?? "").trim();
    const qty = Number(cartObj[rawKey]) || 0;
    if (!key || qty < 1) continue;

    // 1) Buscar por id (correcto)
    // 2) Si no existe, buscar por nombre (carrito viejo)
    const product = byId.get(key) || byNombre.get(key);
    if (!product) continue;

    const price = toNumberPrice(product.precio); // tu JSON usa "precio" [oai_citation:1‡products.json.txt](sediment://file_000000007708720e9c7c5eaea4226aac)
    if (price > 0) total += price * qty;
  }

  return total;
}
