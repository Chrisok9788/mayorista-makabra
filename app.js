import { loadCart, getCart, addItem, updateItem, removeItem, clearCart, totalItems } from "./cart.js";
import {
  renderProducts,
  renderCart,
  updateCartCount,
  populateCategories,
  populateSubcategories,
  filterProducts,
  renderOffersCarousel,
  updateCartTotal,
} from "./ui.js";
import { sendOrder } from "./whatsapp.js";

const CATALOG_ENDPOINT = "/api/catalog";
const LOCAL_CACHE_KEY = "catalog-cache-v1";
const SEARCH_DEBOUNCE_MS = 300;

let products = [];

function debounce(fn, wait) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}

function readCatalogCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.products) ? parsed.products : [];
  } catch {
    return [];
  }
}

function saveCatalogCache(nextProducts) {
  try {
    localStorage.setItem(
      LOCAL_CACHE_KEY,
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        products: nextProducts,
      })
    );
  } catch {
    // storage may be full or disabled
  }
}

async function loadCatalog() {
  const statusEl = document.getElementById("catalog-status");

  try {
    const response = await fetch(CATALOG_ENDPOINT, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    if (!Array.isArray(payload.products)) throw new Error("Invalid payload");

    products = payload.products;
    saveCatalogCache(products);

    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = "Catálogo actualizado.";
    }
  } catch {
    products = readCatalogCache();
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = products.length
        ? "Sin conexión. Mostrando catálogo guardado."
        : "No se pudo cargar el catálogo.";
    }
  }
}

function init() {
  const productsContainer = document.getElementById("products-container");
  const categoryFilter = document.getElementById("category-filter");
  const subcategoryFilter = document.getElementById("subcategory-filter");
  const searchInput = document.getElementById("search-input");
  const cartContainer = document.getElementById("cart-container");
  const cartCount = document.getElementById("cart-count");
  const cartTotal = document.getElementById("cart-total");
  const clearCartBtn = document.getElementById("clear-cart-btn");
  const sendWhatsAppBtn = document.getElementById("send-whatsapp-btn");
  const offersTrack = document.getElementById("offers-track");

  const syncCartUI = () => {
    renderCart(products, getCart(), cartContainer, (id, qty) => {
      updateItem(id, qty);
      syncCartUI();
    }, (id) => {
      removeItem(id);
      syncCartUI();
    });
    updateCartCount(cartCount, totalItems());
    updateCartTotal(cartTotal, products, getCart());
  };

  const applyFilters = () => {
    const filtered = filterProducts(
      products,
      categoryFilter?.value || "",
      searchInput?.value || "",
      subcategoryFilter?.value || ""
    );

    renderProducts(filtered, productsContainer, (id) => {
      addItem(id);
      syncCartUI();
    });
  };

  const debouncedApplyFilters = debounce(applyFilters, SEARCH_DEBOUNCE_MS);

  categoryFilter?.addEventListener("change", () => {
    populateSubcategories(products, categoryFilter.value, subcategoryFilter);
    applyFilters();
  });

  subcategoryFilter?.addEventListener("change", applyFilters);
  searchInput?.addEventListener("input", debouncedApplyFilters);

  clearCartBtn?.addEventListener("click", () => {
    clearCart();
    syncCartUI();
  });

  sendWhatsAppBtn?.addEventListener("click", () => {
    sendOrder(getCart(), products);
  });

  loadCart();
  loadCatalog().then(() => {
    populateCategories(products, categoryFilter);
    populateSubcategories(products, categoryFilter?.value || "", subcategoryFilter);
    renderOffersCarousel(products, null, offersTrack, () => {});
    applyFilters();
    syncCartUI();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    init();
  } catch (error) {
    const statusEl = document.getElementById("catalog-status");
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = "No se pudo inicializar la aplicación.";
    }
    console.error(error);
  }
});
