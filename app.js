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
let baseProducts = []; // lista “base” (se va ajustando por categoría/subcategoría)

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

function rerenderCartUI() {
  const cartContainer = document.getElementById("cart-container");
  renderCart(products, getCart(), cartContainer, handleUpdate, handleRemove);

  const totalEl = document.getElementById("cart-total");
  if (totalEl) totalEl.textContent = `$ ${totalAmount(products)}`;

  updateCartCount(document.getElementById("cart-count"), totalItems());
}

function applySearchAndFilter() {
  const searchEl = document.getElementById("search-input");
  const categoryEl = document.getElementById("category-filter");
  const subcatEl = document.getElementById("subcategory-filter");

  const term = searchEl ? searchEl.value : "";
  const cat = categoryEl ? categoryEl.value : "";
  const sub = subcatEl ? subcatEl.value : "";

  // baseProducts ya está filtrado por categoría/subcategoría; el buscador filtra sobre eso
  let filtered = baseProducts;

  // seguridad extra (si baseProducts no estaba actualizado)
  if (cat) filtered = filtered.filter((p) => (p.categoria || "").trim() === cat);
  if (sub) filtered = filtered.filter((p) => (p.subcategoria || "").trim() === sub);

  if (term) {
    filtered = filterProducts(filtered, "", term);
  }

  renderProducts(filtered, document.getElementById("products-container"), handleAdd);
}

function goToCatalogAndShowProduct(productId) {
  const section = document.getElementById("catalogue");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });

  const prod = products.find((p) => p.id === productId);
  if (!prod) return;

  // renderiza solo el producto
  renderProducts([prod], document.getElementById("products-container"), handleAdd);

  // limpia buscador y selects para evitar confusión
  const searchEl = document.getElementById("search-input");
  if (searchEl) searchEl.value = "";

  const categoryEl = document.getElementById("category-filter");
  if (categoryEl) categoryEl.value = "";

  const subcatEl = document.getElementById("subcategory-filter");
  if (subcatEl) {
    subcatEl.value = "";
    subcatEl.style.display = "none";
  }

  // base vuelve a todo
  baseProducts = products;
}

async function init() {
  loadCart();
  updateCartCount(document.getElementById("cart-count"), totalItems());

  try {
    products = await fetchProducts();
    baseProducts = products;

    // ----- CATEGORÍAS (select nativo, se cierra solo) -----
    const categoryEl = document.getElementById("category-filter");
    if (categoryEl) populateCategories(products, categoryEl);

    // ----- SUBCATEGORÍAS (select nativo, aparece solo si hay categoría) -----
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

      // muestra select subcategoría y lo carga
      subcatEl.style.display = "block";
      populateSubcategories(products, cat, subcatEl);

      // al cambiar categoría, resetea subcategoría
      subcatEl.value = "";

      baseProducts = products.filter((p) => (p.categoria || "").trim() === cat);
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

        baseProducts = products.filter((p) => (p.categoria || "").trim() === cat);
        if (sub) {
          baseProducts = baseProducts.filter((p) => (p.subcategoria || "").trim() === sub);
        }
        applySearchAndFilter();
      });
    }

    // Render inicial catálogo
    applySearchAndFilter();

    // ----- OFERTAS -----
    const frameEl = document.querySelector(".offers-frame");
    const trackEl = document.getElementById("offers-track");
    renderOffersCarousel(products, frameEl, trackEl, goToCatalogAndShowProduct);

    // Carrito inicial
    rerenderCartUI();
  } catch (err) {
    console.error(err);
    const pc = document.getElementById("products-container");
    if (pc) pc.innerHTML = `<p>Ocurrió un error al cargar los productos.</p>`;
  }

  // buscador
  const searchEl = document.getElementById("search-input");
  if (searchEl) searchEl.addEventListener("input", applySearchAndFilter);

  // botones carrito
  const clearBtn = document.getElementById("clear-cart-btn");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    clearCart();
    rerenderCartUI();
  });

  const sendBtn = document.getElementById("send-whatsapp-btn");
  if (sendBtn) sendBtn.addEventListener("click", () => {
    const cart = getCart();
    sendOrder(products, cart);
  });
}

init();
