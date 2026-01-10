/*
 * Punto de entrada de la aplicación. Importa los distintos
 * módulos (datos, carrito, UI, WhatsApp) y coordina su
 * funcionamiento. Gestiona eventos y actualiza la interfaz
 * cuando el usuario interactúa.
 */

import { fetchProducts } from "./data.js";
import {
  loadCart,
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  totalItems,
  totalAmount,
} from "./cart.js";

import {
  renderProducts,
  renderCart,
  updateCartCount,
  populateCategories,
  filterProducts,
  renderOffersCarousel,
  renderCategoryAccordion, // debe existir en ui.js (te dejo más abajo la función)
} from "./ui.js";

import { sendOrder } from "./whatsapp.js";

// Lista de productos
let products = [];
let baseProducts = []; // base filtrada por categoría/subcategoría (panel)
let lastAccordionFilter = null;

// ===== Helpers =====

function goToCatalogAndShowProduct(productId) {
  const catalogSection = document.getElementById("catalogue");
  if (catalogSection) {
    catalogSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const prod = products.find((p) => p.id === productId);
  if (!prod) return;

  // Mostrar SOLO el producto tocado
  const pc = document.getElementById("products-container");
  renderProducts([prod], pc, handleAdd);

  // Reset de filtros visuales
  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.value = "";

  const categorySelect = document.getElementById("category-filter");
  if (categorySelect) categorySelect.value = "";
}

function rerenderCartUI() {
  const cart = getCart();
  const cartItemsEl = document.getElementById("cart-items");
  const cartTotalEl = document.getElementById("cart-total");

  renderCart(cart, products, cartItemsEl, handleUpdate, handleRemove);

  const total = totalAmount(products);
  if (cartTotalEl) cartTotalEl.textContent = `$ ${total.toLocaleString("es-UY")}`;

  updateCartCount(document.getElementById("cart-count"), totalItems());
}

function handleAdd(productId) {
  addItem(productId, 1);
  rerenderCartUI();
}

function handleUpdate(productId, qty) {
  updateItem(productId, qty);
  rerenderCartUI();
}

function handleRemove(productId) {
  removeItem(productId);
  rerenderCartUI();
}

/**
 * Aplica filtrado por categoría (select), búsqueda (input)
 * y la base filtrada del acordeón (subcategorías).
 */
function applySearchAndFilter() {
  const searchInput = document.getElementById("search-input");
  const categorySelect = document.getElementById("category-filter");

  const searchTerm = (searchInput?.value || "").trim();
  const selectedCategory = (categorySelect?.value || "").trim();

  // Base viene del acordeón (si se usó), si no se usó => todos
  let filtered = Array.isArray(baseProducts) ? baseProducts : products;

  // Si el select de categoría está seteado, filtra por esa categoría
  if (selectedCategory) {
    filtered = filtered.filter((p) => (p.categoria || "").trim() === selectedCategory);
  }

  // Búsqueda
  if (searchTerm) {
    // filterProducts normalmente filtra por término en nombre (y opcional categoría).
    // Le pasamos categoría "" porque ya filtramos arriba.
    filtered = filterProducts(filtered, "", searchTerm);
  }

  renderProducts(filtered, document.getElementById("products-container"), handleAdd);
}

// ===== Init =====

async function init() {
  // Carrito
  loadCart();
  updateCartCount(document.getElementById("cart-count"), totalItems());

  try {
    products = await fetchProducts();
    baseProducts = products;

    // Select categorías
    const categoryFilter = document.getElementById("category-filter");
    if (categoryFilter) populateCategories(products, categoryFilter);

    // Panel categorías/subcategorías (acordeón)
    // Firma: renderCategoryAccordion(products, onFilterList)
    // onFilterList recibe un array (lista filtrada) o null para reset.
    if (typeof renderCategoryAccordion === "function") {
      renderCategoryAccordion(products, (filteredListOrNull) => {
        if (Array.isArray(filteredListOrNull)) {
          baseProducts = filteredListOrNull;
          lastAccordionFilter = filteredListOrNull;
        } else {
          baseProducts = products;
          lastAccordionFilter = null;
        }
        applySearchAndFilter();
      });
    }

    // Render inicial catálogo
    applySearchAndFilter();

    // Carrusel ofertas
    // Usamos contenedor real: #offers-container (si existe)
    const offersContainer =
      document.getElementById("offers-container") ||
      document.querySelector(".offers-frame");

    if (offersContainer) {
      renderOffersCarousel(products, offersContainer, (productId) =>
        goToCatalogAndShowProduct(productId)
      );
    }

    // Render carrito inicial
    rerenderCartUI();
  } catch (err) {
    console.error(err);
    const pc = document.getElementById("products-container");
    if (pc) pc.innerHTML = `<p>Ocurrió un error al cargar los productos.</p>`;
  }

  // Eventos filtros
  const searchEl = document.getElementById("search-input");
  if (searchEl) searchEl.addEventListener("input", applySearchAndFilter);

  const catEl = document.getElementById("category-filter");
  if (catEl) catEl.addEventListener("change", applySearchAndFilter);

  // Vaciar carrito
  const clearBtn = document.getElementById("clear-cart-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearCart();
      rerenderCartUI();
    });
  }

  // Enviar pedido
  const sendBtn = document.getElementById("send-order-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      const cart = getCart();
      sendOrder(products, cart);
    });
  }
}

init();
