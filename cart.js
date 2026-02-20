import { store } from "./src/store.js";
import { computeCartTotal } from "./ui.js";

/** Vibración corta (defensiva). */
function vibrate60ms() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(60);
  } catch {
    // noop
  }
}

/**
 * Sincroniza estado en memoria desde el store persistido.
 * El store ya carga desde localStorage en su bootstrap, por eso aquí solo
 * devolvemos una copia del estado actual para conservar la API pública.
 */
export function loadCart() {
  return store.getCart();
}

/** Persistencia aislada en src/store.js. Se mantiene por compatibilidad API. */
export function saveCart() {
  return store.getCart();
}

/** @returns {Record<string, number>} */
export function getCart() {
  return store.getCart();
}

export function totalItems() {
  return Object.values(store.getCart()).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

export function addItem(productKey) {
  store.addToCart(productKey, 1);
  vibrate60ms();
}

export function updateItem(productKey, qty) {
  store.updateCartItemQuantity(productKey, qty);
}

export function removeItem(productKey) {
  store.removeFromCart(productKey);
}

export function clearCart() {
  store.clearCart();
}

/**
 * Calcula el total del carrito reutilizando la lógica centralizada de precios/promos.
 * @param {Record<string, number>} cartObj
 * @param {Array<Record<string, any>>} products
 */
export function totalAmount(cartObj, products) {
  return computeCartTotal(products, cartObj);
}
