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
  populateSubcategories,
  filterProducts,
  renderOffersCarousel,
} from "./ui.js";

import { sendOrder } from "./whatsapp.js";

let products = [];
let baseProducts = [];

// =======================
// HANDLERS CARRITO
// =======================

function handleAdd(productId) {
  addItem(productId);
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

// =======================
// RENDER CARRITO
// =======================

function rerenderCartUI() {
  const cartContainer = document.getElementById("cart-container");
  const cartObj = getCart();

  renderCart(products, cartObj, cartContainer, handleUpdate, handleRemove);

  const totalEl = document.getElementById("cart-total");
  if (totalEl) {
    const total = totalAmount(cartObj, products);
    totalEl.textContent = `$ ${total}`;
  }

  updateCartCount(
    document.getElementById("cart-count"),
    totalItems()
  );
}

// =======================
// FILTROS / BUSCADOR
// =======================

function applySearchAndFilter() {
  const searchEl = document.getElementById("search-input");
  const categoryEl = document.getElementById("category-filter");
  const subcatEl = document.getElementById("subcategory-filter");

  const term = searchEl ? searchEl.value : "";
  const cat = categoryEl ? categoryEl.value : "";
  const sub = subcatEl ? subcatEl.value : "";

  let filtered = baseProducts;

  if (cat) filtered = filtered.filter((p) => (p.categoria || "").trim() === cat);
  if (sub) filtered = filtered.filter((p) => (p.subcategoria || "").trim() === sub);

  if (term) {
    filtered = filterProducts(filtered, "", term);
  }

  renderProducts(
    filtered,
    document.getElementById("products-container"),
    handleAdd
  );
}

// =======================
// OFERTAS → SALTO A CATÁLOGO
// =======================

function goToCatalogAndShowProduct(productId) {
  const section = document.getElementById("catalogue");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });

  const prod = products.find((p) => p.id === productId);
  if (!prod) return;

  renderProducts(
    [prod],
    document.getElementById("products-container"),
    handleAdd
  );

  const searchEl = document.getElementById("search-input");
  if (searchEl) searchEl.value = "";

  const categoryEl = document.getElementById("category-filter");
  if (categoryEl) categoryEl.value = "";

  const subcatEl = document.getElementById("subcategory-filter");
  if (subcatEl) {
    subcatEl.value = "";
    subcatEl.style.display = "none";
  }

  baseProducts = products;
}

// =======================
// INIT
// =======================

async function init() {
  loadCart();
  updateCartCount(
    document.getElementById("cart-count"),
    totalItems()
  );

  try {
    products = await fetchProducts();
    baseProducts = products;

    // Categorías
    const categoryEl = document.getElementById("category-filter");
    if (categoryEl) populateCategories(products, categoryEl);

    const subcatEl = document.getElementById("subcategory-filter");

    const refreshSubcats = () => {
      if (!categoryEl || !subcatEl) return;

      const cat = categoryEl.value;

      if (!cat) {
        subcatEl.value = "";
        subcatEl.style.display = "none";
        baseProducts = products;
        applySearchAndFilter();
        return;
      }

      subcatEl.style.display = "block";
      populateSubcategories(products, cat, subcatEl);

      subcatEl.value = "";
      baseProducts = products.filter(
        (p) => (p.categoria || "").trim() === cat
      );

      applySearchAndFilter();
    };

    if (categoryEl) {
      categoryEl.addEventListener("change", refreshSubcats);
    }

    if (subcatEl) {
      subcatEl.addEventListener("change", () => {
        if (!categoryEl) return;

        const cat = categoryEl.value;
        const sub = subcatEl.value;

        baseProducts = products.filter(
          (p) => (p.categoria || "").trim() === cat
        );

        if (sub) {
          baseProducts = baseProducts.filter(
            (p) => (p.subcategoria || "").trim() === sub
          );
        }

        applySearchAndFilter();
      });
    }

    // Render inicial
    applySearchAndFilter();

    // Ofertas
    const frameEl = document.querySelector(".offers-frame");
    const trackEl = document.getElementById("offers-track");
    renderOffersCarousel(
      products,
      frameEl,
      trackEl,
      goToCatalogAndShowProduct
    );

    rerenderCartUI();
  } catch (err) {
    console.error(err);
    const pc = document.getElementById("products-container");
    if (pc) pc.innerHTML = "<p>Error al cargar productos.</p>";
  }

  // Buscador
  const searchEl = document.getElementById("search-input");
  if (searchEl) {
    searchEl.addEventListener("input", applySearchAndFilter);
  }

  // Vaciar carrito
  const clearBtn = document.getElementById("clear-cart-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearCart();
      rerenderCartUI();
    });
  }

  // =======================
  // ENVIAR POR WHATSAPP (FIX DEFINITIVO)
  // =======================

  const sendBtn = document.getElementById("send-whatsapp-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", (e) => {
      e.preventDefault(); // evita submit / reload
      const cart = getCart();
      sendOrder(cart, products); // ✅ ORDEN CORRECTO
    });
  }
}

init();
