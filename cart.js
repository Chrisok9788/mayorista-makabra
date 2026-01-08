/*
 * Módulo para manejar el carrito de compras: carga, guarda y
 * operaciones sobre los productos almacenados. El carrito se
 * persiste en localStorage para mantener el estado entre
 * recargas.
 */

// Estructura interna del carrito.
// Clave: productId | Valor: cantidad
let cart = {};

/**
 * Carga el carrito desde localStorage.
 */
export function loadCart() {
  try {
    const stored = localStorage.getItem("cart");
    cart = stored ? JSON.parse(stored) : {};
  } catch {
    cart = {};
  }
}

/**
 * Guarda el carrito en localStorage.
 */
export function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
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
  return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

/**
 * Agrega una unidad de un producto al carrito.
 */
export function addItem(productId) {
  cart[productId] = (cart[productId] || 0) + 1;
  saveCart();
}

/**
 * Actualiza la cantidad de un producto.
 * - Si qty < 1 elimina el producto.
 */
export function updateItem(productId, qty) {
  const n = Number(qty);

  if (!Number.isFinite(n) || n < 1) {
    delete cart[productId];
  } else {
    cart[productId] = n;
  }
  saveCart();
}

/**
 * Elimina un producto del carrito.
 */
export function removeItem(productId) {
  delete cart[productId];
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
 * Calcula el MONTO TOTAL del carrito en base a los productos.
 * - Ignora productos con precio 0 (Consultar)
 *
 * @param {Object} cartObj Carrito (id -> cantidad)
 * @param {Array} products Lista de productos
 * @returns {number} Total en pesos
 */
export function totalAmount(cartObj, products) {
  let total = 0;

  for (const productId in cartObj) {
    const qty = Number(cartObj[productId]) || 0;
    const product = products.find((p) => p.id === productId);

    if (product) {
      const price = Number(product.precio) || 0;
      if (price > 0) {
        total += price * qty;
      }
    }
  }

  return total;
}
