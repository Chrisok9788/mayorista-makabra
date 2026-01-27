// app.js — versión MODIFICADA y COMPLETA
// Cambios de esta versión:
// ✅ Total del carrito SIEMPRE redondeado (Math.round) en la UI
// ✅ NO usa totalAmount() (porque no aplica dpc.tramos) → ahora usa computeCartTotal() de ui.js
// ✅ Corrige el error "Can't find variable: Rca" (estaba en renderCategoryGrid)
// ✅ NUEVO: Orden inteligente GENERAL por:
//    categoría → "base" (marca/línea) → sabor → tamaño (ml/gr)
//    (Sirve para Nix, Coca, etc. y para cualquier producto con tamaños/sabores)

import { fetchProducts } from "./data.js";
import {
  loadCart,
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  totalItems,
} from "./cart.js";

import {
  renderProducts,
  renderCart,
  updateCartCount,
  populateCategories,
  populateSubcategories,
  filterProducts,
  renderOffersCarousel,
  computeCartTotal, // ✅ usa el mismo cálculo que el detalle del carrito (dpc.tramos)
} from "./ui.js";

import { sendOrder } from "./whatsapp.js";

let products = [];
let baseProducts = [];
let sending = false;

// =======================
// ✅ REDONDEO (UYU)
// =======================
function roundUYU(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x) : 0;
}
function formatUYU(n) {
  return `$ ${roundUYU(n)}`;
}

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
  const v = p?.precio ?? p?.price;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

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
// ✅ ORDEN INTELIGENTE GENERAL
// categoría → base → sabor → tamaño
// =======================

function normText(x) {
  return String(x || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/,/g, ".")
    .trim();
}

// Detecta tamaño en ml o gramos (sirve para bebidas y sólidos)
function parseSizeKey(product) {
  const raw = normText(
    [product?.presentacion, product?.presentación, product?.nombre, product?.name]
      .filter(Boolean)
      .join(" ")
  );

  // ml
  let m = raw.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (m) return { kind: "ml", value: Math.round(Number(m[1])) };

  // cc (1cc=1ml)
  m = raw.match(/(\d+(?:\.\d+)?)\s*cc\b/);
  if (m) return { kind: "ml", value: Math.round(Number(m[1])) };

  // litros: l / lt / lts / litro(s)
  m = raw.match(/(\d+(?:\.\d+)?)\s*(l|lt|lts|litro|litros)\b/);
  if (m) return { kind: "ml", value: Math.round(Number(m[1]) * 1000) };

  // pegado: 2.25l / 1lt
  m = raw.match(/(\d+(?:\.\d+)?)(l|lt|lts)\b/);
  if (m) return { kind: "ml", value: Math.round(Number(m[1]) * 1000) };

  // gramos: g / gr / grs / gramos
  m = raw.match(/(\d+(?:\.\d+)?)\s*(g|gr|grs|gramo|gramos)\b/);
  if (m) return { kind: "g", value: Math.round(Number(m[1])) };

  // kg
  m = raw.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos)\b/);
  if (m) return { kind: "g", value: Math.round(Number(m[1]) * 1000) };

  return null;
}

// Si viene "1" sin unidad, SOLO para bebidas conocidas lo tratamos como 1L
function fallbackOneLiterForBeverages(product) {
  const raw = normText(
    [product?.presentacion, product?.nombre, product?.name]
      .filter(Boolean)
      .join(" ")
  );

  // lista mínima de bebidas típicas (podés agregar marcas si querés)
  const looksLikeBeverage =
    raw.includes("coca") ||
    raw.includes("nix") ||
    raw.includes("cola") ||
    raw.includes("agua") ||
    raw.includes("fanta") ||
    raw.includes("sprite") ||
    raw.includes("pepsi") ||
    raw.includes("refresco");

  if (!looksLikeBeverage) return Number.POSITIVE_INFINITY;

  // Detecta un "1" suelto (evita 10, 12, etc.)
  const m = raw.match(/(?:^|\D)1(?:\D|$)/);
  return m ? 1000 : Number.POSITIVE_INFINITY;
}

// Orden de sabores (ajustable)
const FLAVOR_ORDER = [
  "cola",
  "lima",
  "limon",
  "pomelo",
  "naranja",
  "manzana",
  "uva",
  "tonica",
  "ginger",
  "sin azucar",
  "cero",
  "zero",
  "light",
];

function detectFlavor(product) {
  const raw = normText(
    [product?.nombre, product?.name, product?.presentacion, product?.presentación]
      .filter(Boolean)
      .join(" ")
  );

  // normalizaciones rápidas por acentos
  const s = raw
    .replace("limón", "limon")
    .replace("tónica", "tonica")
    .replace("sin azúcar", "sin azucar")
    .replace("s/azúcar", "sin azucar")
    .replace("s/azucar", "sin azucar");

  for (const key of FLAVOR_ORDER) {
    if (s.includes(key)) return key;
  }
  return ""; // sin sabor explícito
}

function flavorRank(flavor) {
  if (!flavor) return 999; // los “sin sabor” al final del grupo
  const idx = FLAVOR_ORDER.indexOf(flavor);
  return idx >= 0 ? idx : 998;
}

// Base/Línea: usa marca si existe; si no, adivina (coca cola, nix, etc.)
function detectBase(product) {
  const marca = normText(product?.marca);
  if (marca) return marca;

  const raw0 = normText(product?.nombre ?? product?.name);

  // saco tamaños típicos para no romper el agrupado
  const raw = raw0
    .replace(/\b\d+(?:\.\d+)?\s*(ml|cc|l|lt|lts|litro|litros|g|gr|grs|kg|kgs|kilo|kilos)\b/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "otros";

  const tokens = raw.split(" ");
  const two = tokens.slice(0, 2).join(" ");

  if (two === "coca cola") return "coca cola";
  return tokens[0]; // nix / coca / fanta / etc.
}

// Orden final: categoría → base → sabor → tamaño → nombre
function sortCatalogue(list) {
  const arr = [...(list || [])];

  arr.sort((a, b) => {
    // 1) categoría A-Z
    const catA = getCat(a);
    const catB = getCat(b);
    const catCmp = catA.localeCompare(catB, "es");
    if (catCmp !== 0) return catCmp;

    // 2) base/línea A-Z
    const baseA = detectBase(a);
    const baseB = detectBase(b);
    const baseCmp = baseA.localeCompare(baseB, "es");
    if (baseCmp !== 0) return baseCmp;

    // 3) sabor (orden definido)
    const flA = detectFlavor(a);
    const flB = detectFlavor(b);
    const frA = flavorRank(flA);
    const frB = flavorRank(flB);
    if (frA !== frB) return frA - frB;

    // 4) tamaño (ml o g) ascendente
    const ak = parseSizeKey(a);
    const bk = parseSizeKey(b);

    let aV = ak ? ak.value : null;
    let bV = bk ? bk.value : null;

    if (aV == null) aV = fallbackOneLiterForBeverages(a);
    if (bV == null) bV = fallbackOneLiterForBeverages(b);

    if (aV !== bV) return aV - bV;

    // 5) desempate: nombre A-Z
    const an = normText(getName(a));
    const bn = normText(getName(b));
    return an.localeCompare(bn, "es");
  });

  return arr;
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
  const map = new Map();
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

  // ✅ FIX: antes decía Rca.name / Rca.count (rompía todo)
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

  // renderCart ya muestra unit/subtotal con dpc.tramos
  renderCart(products, cartObj, cartContainer, handleUpdate, handleRemove);

  // ✅ Total coherente con el detalle: computeCartTotal() (aplica dpc.tramos)
  // ✅ y redondeo final (Math.round)
  const totalEl = document.getElementById("cart-total");
  if (totalEl) {
    const totalRaw = computeCartTotal(products, cartObj); // puede devolver decimal si hay precios con decimales
    totalEl.textContent = formatUYU(totalRaw); // ✅ redondeo final
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

  if (term) filtered = filterProducts(filtered, "", term);

  // ✅ NUEVO: ordenar siempre antes de renderizar
  filtered = sortCatalogue(filtered);

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

    // Nota: el redondeo del mensaje de WhatsApp se corrige en whatsapp.js
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

    products = normalizeList(raw);

    // ✅ NUEVO: dejar el catálogo ordenado desde el inicio
    products = sortCatalogue(products);
    baseProducts = products;

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

    showCategoriesMode();
    clearProductsUI();

    const frameEl = document.querySelector(".offers-frame");
    const trackEl = document.getElementById("offers-track");
    renderOffersCarousel(products, frameEl, trackEl, goToCatalogAndShowProduct);

    rerenderCartUI();
  } catch (err) {
    console.error(err);
    const pc = document.getElementById("products-container");
    if (pc) {
      pc.innerHTML = `<p style="color:#b00020;font-weight:700">Error al cargar productos: ${String(
        err?.message || err
      )}</p>`;
    }
    showProductsMode();
  }

  const searchEl = document.getElementById("search-input");
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      if (searchEl.value.trim()) showProductsMode();
      applySearchAndFilter();
    });
  }

  const clearBtn = document.getElementById("clear-cart-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearCart();
      rerenderCartUI();
    });
  }

  const sendBtn = document.getElementById("send-whatsapp-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendWhatsAppOrderSafe();
    });
  }

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
