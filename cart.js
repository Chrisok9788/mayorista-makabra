/*
 * Módulo para manejar el carrito de compras: carga, guarda y
 * operaciones sobre los productos almacenados. El carrito se
 * persiste en localStorage para mantener el estado entre
 * recargas.
 */

// Estructura interna del carrito. Las claves son IDs de
// productos y los valores son cantidades. Se inicializa vacío
// y se actualiza al cargar desde almacenamiento.
let cart = {};

/**
 * Carga el carrito desde localStorage. Si no hay datos
 * guardados o ocurre un error al parsear, se inicializa un
 * carrito vacío. Se recomienda llamar a esta función una vez
 * al iniciar la aplicación.
 */
export function loadCart() {
  try {
    const stored = localStorage.getItem('cart');
    cart = stored ? JSON.parse(stored) : {};
  } catch {
    cart = {};
  }
}

/**
 * Guarda el estado actual del carrito en localStorage. Esta
 * función se invoca internamente cada vez que se modifica el
 * carrito.
 */
export function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
}

/**
 * Devuelve una copia superficial del carrito actual. Así se
 * evita que otras funciones modifiquen accidentalmente la
 * referencia interna.
 *
 * @returns {Object} Una copia del objeto de carrito actual.
 */
export function getCart() {
  return { ...cart };
}

/**
 * Devuelve el número total de ítems en el carrito, sumando
 * cantidades. Por ejemplo, si hay 2 unidades del producto 1 y
 * 3 del producto 2, totalItems() devolverá 5.
 *
 * @returns {number} Cantidad total de ítems.
 */
export function totalItems() {
  return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

/**
 * Agrega una unidad del producto indicado al carrito. Si el
 * producto ya existe en el carrito, incrementa la cantidad.
 *
 * @param {string} productId Identificador del producto.
 */
export function addItem(productId) {
  cart[productId] = (cart[productId] || 0) + 1;
  saveCart();
}

/**
 * Establece la cantidad de un producto en el carrito. Si la
 * cantidad es menor a 1 se elimina el ítem.
 *
 * @param {string} productId Identificador del producto.
 * @param {number} qty Cantidad deseada.
 */
export function updateItem(productId, qty) {
  if (qty < 1) {
    delete cart[productId];
  } else {
    cart[productId] = qty;
  }
  saveCart();
}

/**
 * Elimina un producto del carrito.
 *
 * @param {string} productId Identificador del producto a eliminar.
 */
export function removeItem(productId) {
  delete cart[productId];
  saveCart();
}

/**
 * Vacía completamente el carrito y actualiza el almacenamiento.
 */
export function clearCart() {
  cart = {};
  saveCart();
}