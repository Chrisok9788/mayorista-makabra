/*
 * Módulo para manejar el carrito de compras: carga, guarda y
 * operaciones sobre los productos almacenados. El carrito se
 * persiste en localStorage para mantener el estado entre
 * recargas.
 */

// Estructura interna del carrito.
// Clave: productId | Valor: cantidad
let cart = {};

// Clave de localStorage (por si querés cambiarla en el futuro)
const CART_KEY = "cart";

/**
 * Borra completamente el carrito guardado (útil para "carrito viejo").
 */
export function resetCartStorage() {
  try {
    localStorage.removeItem(CART_KEY);
  } finally {
    cart = {};
  }
}

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

  // Limpieza básica: elimina entradas inválidas (NaN, <=0, keys vacías)
  for (const k of Object.keys(cart)) {
    const id = String(k ?? "").trim();
    const qty = Number(cart[k]);

    if (!id || !Number.isFinite(qty) || qty < 1) {
      delete cart[k];
    } else if (id !== k) {
      // normaliza key (quita espacios)
      delete cart[k];
      cart[id] = qty;
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
export function addItem(productId) {
  const id = String(productId ?? "").trim();
  if (!id) return;

  cart[id] = (cart[id] || 0) + 1;
  saveCart();
}

/**
 * Actualiza la cantidad de un producto.
 * - Si qty < 1 elimina el producto.
 */
export function updateItem(productId, qty) {
  const id = String(productId ?? "").trim();
  const n = Number(qty);

  if (!id) return;

  if (!Number.isFinite(n) || n < 1) {
    delete cart[id];
  } else {
    cart[id] = n;
  }
  saveCart();
}

/**
 * Elimina un producto del carrito.
 */
export function removeItem(productId) {
  const id = String(productId ?? "").trim();
  if (!id) return;

  delete cart[id];
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
 * Normaliza un precio (por si viene como string).
 */
function toNumberPrice(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;

  let s = String(v).trim();
  // quita $ y espacios
  s = s.replace(/\$/g, "").trim();
  // quita separadores de miles "." y convierte coma a punto
  s = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Limpia automáticamente el "carrito viejo":
 * si hay IDs en el carrito que no existen en products, los elimina.
 *
 * Llamalo una vez cuando ya tengas products cargado.
 */
export function reconcileCartWithProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return;

  const ids = new Set(products.map((p) => String(p.id ?? "").trim()).filter(Boolean));
  let changed = false;

  for (const k of Object.keys(cart)) {
    const id = String(k ?? "").trim();
    if (!ids.has(id)) {
      delete cart[k];
      changed = true;
    }
  }

  if (changed) saveCart();
}

/**
 * Calcula el MONTO TOTAL del carrito en base a los productos.
 * - Ignora productos con precio 0 (Consultar)
 *
 * @param {Object} cartObj Carrito (id -> cantidad)
 * @param {Array} products Lista de productos
 * @returns {number} Total en pesos
 */
export function totalAmount(cartObj, products) {
  if (!cartObj || typeof cartObj !== "object") return 0;
  if (!Array.isArray(products) || products.length === 0) return 0;

  // Map para buscar por id rápido y sin depender de find()
  const byId = new Map(
    products.map((p) => [String(p.id ?? "").trim(), p])
  );

  let total = 0;

  for (const rawId in cartObj) {
    const productId = String(rawId ?? "").trim();
    const qty = Number(cartObj[rawId]) || 0;
    if (!productId || qty < 1) continue;

    const product = byId.get(productId);
    if (!product) continue;

    const price = toNumberPrice(product.precio);
    if (price > 0) total += price * qty;
  }

  return total;
}
