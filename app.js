/*
 * Punto de entrada de la aplicación. Importa los distintos
 * módulos (datos, carrito, UI, WhatsApp) y coordina su
 * funcionamiento. Gestiona eventos y actualiza la interfaz
 * cuando el usuario interactúa.
 */

import { fetchProducts } from './data.js';
import {
  loadCart,
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  totalItems,
} from './cart.js';
import {
  renderProducts,
  renderCart,
  updateCartCount,
  populateCategories,
  filterProducts,
} from './ui.js';
import { sendOrder } from './whatsapp.js';

// Lista de productos cargada desde el JSON
let products = [];

/**
 * Manejador para agregar un producto al carrito.
 *
 * @param {string} productId Identificador del producto a agregar.
 */
function handleAdd(productId) {
  addItem(productId);
  updateCartCount(document.getElementById('cart-count'), totalItems());
  renderCart(products, getCart(), document.getElementById('cart-container'), handleUpdate, handleRemove);
}

/**
 * Manejador para actualizar la cantidad de un producto en el carrito.
 *
 * @param {string} productId Identificador del producto.
 * @param {number} qty Nueva cantidad.
 */
function handleUpdate(productId, qty) {
  updateItem(productId, qty);
  updateCartCount(document.getElementById('cart-count'), totalItems());
  renderCart(products, getCart(), document.getElementById('cart-container'), handleUpdate, handleRemove);
}

/**
 * Manejador para eliminar un producto del carrito.
 *
 * @param {string} productId Identificador del producto a eliminar.
 */
function handleRemove(productId) {
  removeItem(productId);
  updateCartCount(document.getElementById('cart-count'), totalItems());
  renderCart(products, getCart(), document.getElementById('cart-container'), handleUpdate, handleRemove);
}

/**
 * Aplica el filtrado según la categoría seleccionada y el término
 * de búsqueda ingresado, luego renderiza la grilla de productos.
 */
function applySearchAndFilter() {
  const searchTerm = document.getElementById('search-input').value;
  const selectedCategory = document.getElementById('category-filter').value;
  const filtered = filterProducts(products, selectedCategory, searchTerm);
  renderProducts(filtered, document.getElementById('products-container'), handleAdd);
}

/**
 * Inicializa la aplicación. Carga el carrito y los productos,
 * renderiza la interfaz inicial y configura los eventos de
 * interacción del usuario.
 */
async function init() {
  // Recuperar el carrito almacenado
  loadCart();
  updateCartCount(document.getElementById('cart-count'), totalItems());
  try {
    products = await fetchProducts();
    populateCategories(products, document.getElementById('category-filter'));
    renderProducts(products, document.getElementById('products-container'), handleAdd);
    renderCart(products, getCart(), document.getElementById('cart-container'), handleUpdate, handleRemove);
  } catch (err) {
    console.error(err);
    document.getElementById('products-container').innerHTML = `<p>Ocurrió un error al cargar los productos.</p>`;
  }
  // Configurar eventos
  document.getElementById('search-input').addEventListener('input', applySearchAndFilter);
  document.getElementById('category-filter').addEventListener('change', applySearchAndFilter);
  document.getElementById('clear-cart-btn').addEventListener('click', () => {
    clearCart();
    updateCartCount(document.getElementById('cart-count'), totalItems());
    renderCart(products, getCart(), document.getElementById('cart-container'), handleUpdate, handleRemove);
  });
  document.getElementById('send-whatsapp-btn').addEventListener('click', () => {
    const currentCart = getCart();
    if (Object.keys(currentCart).length === 0) {
      alert('Tu carrito está vacío');
      return;
    }
    sendOrder(currentCart, products);
  });
}

// Ejecutar la inicialización al cargar el módulo
init();


