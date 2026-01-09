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
  renderOffersCarousel, // ✅ Carrusel de ofertas
} from "./ui.js";
import { sendOrder } from "./whatsapp.js";

// Lista de productos cargada desde el JSON
let products = [];

/**
 * Lleva al catálogo (HTML actual: id="catalogue") y muestra el producto tocado en ofertas.
 * Esto NO rompe el sitio porque respeta tus anclas existentes.
 */
function goToCatalogAndShowProduct(productId) {
  // ✅ Usamos el id real existente en tu HTML
  const catalogSection = document.getElementById("catalogue");
  if (catalogSection) {
    catalogSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const prod = products.find((p) => p.id === productId);
  if (!prod) return;

  // Mostrar SOLO el producto seleccionado en el catálogo
  renderProducts([prod], document.getElementById("products-container"), handleAdd);

  // Limpiar filtros visualmente (evita confusión)
  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.value = "";

  const categorySelect = document.getElementById("category-filter");
  if (categorySelect) categorySelect.value = "";
}

/**
 * Actualiza el total en $ del carrito en la UI.
 * Requiere un elemento con id="cart-total" en el HTML.
 */
function updateTotal() {
  const totalEl = document.getElementById("cart-total");
  if (!totalEl) return;

  const total = totalAmount(getCart(), products);
  totalEl.textContent = "$ " + (Number(total) || 0).toLocaleString("es-UY");
}

/**
 * Re-render del carrito + contador + total (para evitar duplicación).
 */
function rerenderCartUI() {
  updateCartCount(document.getElementById("cart-count"), totalItems());

  renderCart(
    products,
    getCart(),
    document.getElementById("cart-container"),
    handleUpdate,
    handleRemove
  );

  updateTotal();
}

/**
 * Manejador para agregar un producto al carrito.
 */
function handleAdd(productId) {
  addItem(productId);
  rerenderCartUI();
}

/**
 * Manejador para actualizar la cantidad de un producto en el carrito.
 */
function handleUpdate(productId, qty) {
  updateItem(productId, qty);
  rerenderCartUI();
}

/**
 * Manejador para eliminar un producto del carrito.
 */
function handleRemove(productId) {
  removeItem(productId);
  rerenderCartUI();
}

/**
 * Aplica filtrado por categoría y búsqueda y vuelve a renderizar.
 */
function applySearchAndFilter() {
  const searchInput = document.getElementById("search-input");
  const categorySelect = document.getElementById("category-filter");

  const searchTerm = searchInput ? searchInput.value : "";
  const selectedCategory = categorySelect ? categorySelect.value : "";

  const filtered = filterProducts(products, selectedCategory, searchTerm);
  renderProducts(filtered, document.getElementById("products-container"), handleAdd);
}

/**
 * Inicializa la aplicación.
 */
async function init() {
  // Cargar carrito desde localStorage
  loadCart();
  updateCartCount(document.getElementById("cart-count"), totalItems());

  try {
    // Cargar productos
    products = await fetchProducts();

    // Categorías
    const categoryFilter = document.getElementById("category-filter");
    if (categoryFilter) populateCategories(products, categoryFilter);

    // Render catálogo
    renderProducts(products, document.getElementById("products-container"), handleAdd);

    // ✅ Render carrusel de ofertas + click => ir al catálogo
    renderOffersCarousel(
      products,
      document.querySelector(".offers-frame"),
      document.querySelector("#offers-track"), // ✅ en tu HTML es ID
      (productId) => goToCatalogAndShowProduct(productId)
    );

    // Render carrito inicial + total
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

  // Enviar WhatsApp
  const sendBtn = document.getElementById("send-whatsapp-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      const currentCart = getCart();
      if (Object.keys(currentCart).length === 0) {
        alert("Tu carrito está vacío");
        return;
      }
      sendOrder(currentCart, products);
    });
  }
}

// Ejecutar inicialización
init();
