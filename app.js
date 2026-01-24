// app.js — versión MODIFICADA y COMPLETA
// Objetivos:
// 1) Mantener tu UI de “modo categorías / modo productos”.
// 2) Hacerlo compatible con products.json viejo (nombre/categoria/subcategoria/precio/oferta/imagen)
//    y con formato nuevo (name/category/subcategory/price/offer/img).
// 3) Arreglar el “Error al cargar productos” mostrando el motivo real (desde data.js robusto).
// 4) Mantener carrusel de ofertas funcionando.
// 5) Evitar que el filtro rompa cuando los campos vienen con nombres distintos.

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
let sending = false; // evita doble click/doble envío

// =======================
// NORMALIZACIÓN (compatibilidad JSON viejo/nuevo)
// =======================

function normStr(v) {
  return String(v ?? "").trim();
}

function getCat(p) {
  return normStr(p?.categoria ?? p?.category) || "Otros";
}

function getSub(p) {
  return normStr(p?.subcategoria ?? p?.subcategory);
}

function getName(p) {
  return normStr(p?.nombre ?? p?.name) || "Producto";
}

function getId(p) {
  return normStr(p?.id ?? p?.scanntechId ?? p?.codigoInterno);
}

function isOffer(p) {
  const v = p?.oferta ?? p?.offer;
  return v === true;
}

function getImg(p) {
  return normStr(p?.imagen ?? p?.img);
}

function getPrice(p) {
  // precio viejo o price nuevo
  const v = p?.precio ?? p?.price;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Devuelve un producto en “formato viejo” para que UI/cart/whatsapp sigan sin romper.
 * (Tu ui.js está hecho para: nombre/categoria/subcategoria/precio/oferta/imagen)
 */
function normalizeProduct(p) {
  return {
    ...p,
    id: getId(p) || normStr(p?.id),
    nombre: getName(p),
    categoria: getCat(p),
    subcategoria: getSub(p),
    precio: getPrice(p),
    oferta: isOffer(p),
    imagen: getImg(p),
  };
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeProduct).filter((p) => p.id);
}

// =======================
// UI: MODO CATEGORÍAS / MODO PRODUCTOS
// =======================

function showCategoriesMode() {
  const grid = document.getElementById("categoriesGrid");
  const pc = document.getElementById("products-container");
  if (grid) grid.style.display = "grid";
  if (pc) pc.style.display = "none";
}

function showProductsMode() {
  const grid = document.getElementById("categoriesGrid");
  const pc = document.getElementById("products-container");
  if (grid) grid.style.display = "none";
  if (pc) pc.style.display = "grid";
}

function clearProductsUI() {
  const pc = document.getElementById("products-container");
  if (pc) pc.innerHTML = "";
}

function buildCategoryCounts(items) {
  const map = new Map(); // categoria -> count
  for (const p of items) {
    const cat = getCat(p);
    map.set(cat, (map.get(cat) || 0) + 1);
  }

  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .map(([name, count]) => ({ name, count }));
}

function renderCategoryGrid(categories, onClick) {
  const grid = document.getElementById("categoriesGrid");
  if (!grid) return;

  grid.innerHTML = categories
    .map(
      (c) => `
      <div class="category-card" data-cat="${encodeURIComponent(c.name)}">
        <h3>${c.name}</h3>
        <p>${c.count} artículos</p>
      </div>
    `
    )
    .join("");

  grid.querySelectorAll(".category-card").forEach((card) => {
    card.addEventListener("click", () => {
      const cat = decodeURIComponent(card.dataset.cat);
      onClick(cat);
    });
  });
}

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

  updateCartCount(document.getElementById("cart-count"), totalItems());
}

// =======================
// FILTROS / BUSCADOR
// =======================

function applySearchAndFilter() {
  const searchEl = document.getElementById("search-input");
  const categoryEl = document.getElementById("category-filter");
  const subcatEl = document.getElementById("subcategory-filter");

  const term = searchEl ? searchEl.value.trim() : "";
  const cat = categoryEl ? categoryEl.value : "";
  const sub = subcatEl ? subcatEl.value : "";

  // Si no hay filtros ni búsqueda: mostrar categorías y no listar productos
  if (!term && !cat && !sub) {
    showCategoriesMode();
    clearProductsUI();
    baseProducts = products;
    return;
  }

  showProductsMode();

  let filtered = baseProducts;

  if (cat) filtered = filtered.filter((p) => getCat(p) === cat);
  if (sub) filtered = filtered.filter((p) => getSub(p) === sub);

  if (term) {
    filtered = filterProducts(filtered, "", term);
  }

  renderProducts(filtered, document.getElementById("products-container"), handleAdd);
}

// =======================
// OFERTAS → SALTO A CATÁLOGO
// =======================

function goToCatalogAndShowProduct(productId) {
  const section = document.getElementById("catalogue");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });

  const prod = products.find((p) => String(p.id) === String(productId));
  if (!prod) return;

  // Al venir desde ofertas: mostrar productos (no categorías)
  showProductsMode();

  renderProducts([prod], document.getElementById("products-container"), handleAdd);

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
// ENVÍO ROBUSTO WHATSAPP
// =======================

function sendWhatsAppOrderSafe() {
  if (sending) return;
  sending = true;

  try {
    const cart = getCart();

    if (!products || products.length === 0) {
      alert("Todavía no cargó el catálogo. Recargá la página y probá de nuevo.");
      return;
    }

    if (!cart || Object.keys(cart).length === 0) {
      alert("Tu carrito está vacío.");
      return;
    }

    sendOrder(cart, products);
  } catch (err) {
    console.error("Error al enviar pedido:", err);

    const fallback = document.getElementById("send-whatsapp-link");
    if (fallback && fallback.href) {
      window.location.href = fallback.href;
    } else {
      alert("No se pudo abrir WhatsApp. Revisá tu conexión y probá de nuevo.");
    }
  } finally {
    setTimeout(() => (sending = false), 800);
  }
}

// =======================
// INIT
// =======================

async function init() {
  loadCart();
  updateCartCount(document.getElementById("cart-count"), totalItems());

  try {
    const raw = await fetchProducts();

    // ✅ normalizamos para que todo el sitio use mismo formato
    products = normalizeList(raw);
    baseProducts = products;

    // ✅ Render inicial del GRID de categorías
    const categories = buildCategoryCounts(products);
    renderCategoryGrid(categories, (selectedCategory) => {
      const categoryEl = document.getElementById("category-filter");
      if (categoryEl) {
        categoryEl.value = selectedCategory;
        categoryEl.dispatchEvent(new Event("change"));
      }

      showProductsMode();

      const section = document.getElementById("catalogue");
      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Categorías (select)
    const categoryEl = document.getElementById("category-filter");
    if (categoryEl) populateCategories(products, categoryEl);

    const subcatEl = document.getElementById("subcategory-filter");

    const refreshSubcats = () => {
      if (!categoryEl || !subcatEl) return;

      const cat = categoryEl.value;

      // Si el usuario vuelve a "Todas las categorías"
      if (!cat) {
        subcatEl.value = "";
        subcatEl.style.display = "none";
        baseProducts = products;
        applySearchAndFilter();
        return;
      }

      // Al elegir categoría: mostramos productos
      showProductsMode();

      subcatEl.style.display = "block";
      populateSubcategories(products, cat, subcatEl);

      subcatEl.value = "";
      baseProducts = products.filter((p) => getCat(p) === cat);

      applySearchAndFilter();
    };

    if (categoryEl) categoryEl.addEventListener("change", refreshSubcats);

    if (subcatEl) {
      subcatEl.addEventListener("change", () => {
        if (!categoryEl) return;

        const cat = categoryEl.value;
        const sub = subcatEl.value;

        baseProducts = products.filter((p) => getCat(p) === cat);
        if (sub) baseProducts = baseProducts.filter((p) => getSub(p) === sub);

        showProductsMode();
        applySearchAndFilter();
      });
    }

    // No listamos todo al entrar, dejamos modo categorías
    showCategoriesMode();
    clearProductsUI();

    // Ofertas (usa oferta:true)
    const frameEl = document.querySelector(".offers-frame");
    const trackEl = document.getElementById("offers-track");
    renderOffersCarousel(products, frameEl, trackEl, goToCatalogAndShowProduct);

    rerenderCartUI();
  } catch (err) {
    console.error(err);

    // ✅ Mostrar error real en pantalla
    const pc = document.getElementById("products-container");
    if (pc) {
      pc.innerHTML = `<p style="color:#b00020;font-weight:700">Error al cargar productos: ${String(
        err?.message || err
      )}</p>`;
    }

    // Si falla, igual mostramos “modo productos” para que se vea el mensaje
    showProductsMode();
  }

  // Buscador
  const searchEl = document.getElementById("search-input");
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      if (searchEl.value.trim()) showProductsMode();
      applySearchAndFilter();
    });
  }

  // Vaciar carrito
  const clearBtn = document.getElementById("clear-cart-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearCart();
      rerenderCartUI();
    });
  }

  // Listener directo
  const sendBtn = document.getElementById("send-whatsapp-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendWhatsAppOrderSafe();
    });
  }

  // Listener por delegación
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target?.closest?.("#send-whatsapp-btn");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();
      sendWhatsAppOrderSafe();
    },
    true
  );
}

init();
