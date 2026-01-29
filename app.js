// app.js — versión MODIFICADA y COMPLETA
// Cambios (además de lo que ya tenías):
// ✅ “Más vendidos” con memoria local (localStorage) por dispositivo
//    - 1 función que actualiza ranking al enviar WhatsApp
//    - 1 función que devuelve Top 10
//    - 1 carrusel “Más vendidos” (si existe #bestsellers-track en el HTML)
// ✅ “Más nuevos” (Top 10) (si existe #newest-track en el HTML)
// ⚠️ Nota: para que se vean los 2 carruseles nuevos, tu index.html debe tener
//   secciones con <div id="bestsellers-track"> y <div id="newest-track">.
//   Si no existen, el código no rompe: simplemente no renderiza.

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
  computeCartTotal,
} from "./ui.js";

import { sendOrder } from "./whatsapp.js";

let products = [];
let baseProducts = [];
let sending = false;

// =======================
// ✅ FIX iOS “pantalla blanca hasta girar”
// =======================
function isIOS() {
  const ua = navigator.userAgent || "";
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

function forceIOSRepaint() {
  if (!isIOS()) return;

  document.body.style.webkitTransform = "translateZ(0)";
  void document.body.offsetHeight;
  document.body.style.webkitTransform = "";

  window.dispatchEvent(new Event("resize"));
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
}

window.addEventListener("pageshow", (e) => {
  if (e.persisted) forceIOSRepaint();
});

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
// ✅ “MÁS VENDIDOS” (localStorage por dispositivo)
// =======================
const SALES_KEY = "mk_sales_v1";

function loadSalesMap() {
  try {
    const raw = localStorage.getItem(SALES_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveSalesMap(map) {
  try {
    localStorage.setItem(SALES_KEY, JSON.stringify(map || {}));
  } catch {
    // si el storage está lleno o bloqueado, no hacemos nada
  }
}

/**
 * ✅ 1) Actualiza ranking de ventas usando el carrito
 * (se llama al momento de enviar el pedido por WhatsApp)
 */
function bumpSalesFromCart(cart) {
  if (!cart || typeof cart !== "object") return;

  const sales = loadSalesMap();

  for (const [rawId, rawQty] of Object.entries(cart)) {
    const id = String(rawId ?? "").trim();
    const qty = Number(rawQty) || 0;
    if (!id || qty <= 0) continue;
    sales[id] = (Number(sales[id]) || 0) + qty;
  }

  saveSalesMap(sales);
}

/**
 * ✅ 2) Devuelve Top N IDs por “más vendidos” (según localStorage)
 */
function getTopSoldIds(n = 10) {
  const sales = loadSalesMap();
  const entries = Object.entries(sales)
    .map(([id, qty]) => [String(id), Number(qty) || 0])
    .filter(([, qty]) => qty > 0);

  entries.sort((a, b) => b[1] - a[1]); // desc
  return entries.slice(0, n).map(([id]) => id);
}

function getTopSoldProducts(allProducts, n = 10) {
  const ids = getTopSoldIds(n);
  if (!ids.length) return [];

  const byId = new Map((allProducts || []).map((p) => [String(p.id), p]));
  const list = ids.map((id) => byId.get(id)).filter(Boolean);

  return list.slice(0, n);
}

// =======================
// ✅ “MÁS NUEVOS” (Top N)
// - Si tu JSON trae createdAt/updatedAt/date/timestamp: ordena por eso
// - Si no trae nada: usa el orden del array (últimos N)
// =======================
function extractDateMs(p) {
  const candidates = [
    p?.createdAt,
    p?.created_at,
    p?.updatedAt,
    p?.updated_at,
    p?.fecha,
    p?.date,
    p?.timestamp,
  ];

  for (const v of candidates) {
    if (!v) continue;
    const ms =
      typeof v === "number"
        ? v
        : Date.parse(String(v));
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function getNewestProducts(allProducts, n = 10) {
  const arr = [...(allProducts || [])];
  if (!arr.length) return [];

  // Si al menos uno tiene fecha, ordenamos por fecha desc
  const anyHasDate = arr.some((p) => extractDateMs(p) != null);

  if (anyHasDate) {
    arr.sort((a, b) => {
      const am = extractDateMs(a) ?? 0;
      const bm = extractDateMs(b) ?? 0;
      return bm - am;
    });
    return arr.slice(0, n);
  }

  // Fallback: últimos N del array
  return arr.slice(-n).reverse();
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
// =======================
function normText(x) {
  return String(x || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/,/g, ".")
    .trim();
}

function parseSizeKey(product) {
  const raw = normText(
    [product?.presentacion, product?.presentación, product?.nombre, product?.name]
      .filter(Boolean)
      .join(" ")
  );

  let m = raw.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (m) return { kind: "ml", value: Math.round(Number(m[1])) };

  m = raw.match(/(\d+(?:\.\d+)?)\s*cc\b/);
  if (m) return { kind: "ml", value: Math.round(Number(m[1])) };

  m = raw.match(/(\d+(?:\.\d+)?)\s*(l|lt|lts|litro|litros)\b/);
  if (m) return { kind: "ml", value: Math.round(Number(m[1]) * 1000) };

  m = raw.match(/(\d+(?:\.\d+)?)(l|lt|lts)\b/);
  if (m) return { kind: "ml", value: Math.round(Number(m[1]) * 1000) };

  m = raw.match(/(\d+(?:\.\d+)?)\s*(g|gr|grs|gramo|gramos)\b/);
  if (m) return { kind: "g", value: Math.round(Number(m[1])) };

  m = raw.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos)\b/);
  if (m) return { kind: "g", value: Math.round(Number(m[1]) * 1000) };

  return null;
}

function fallbackOneLiterForBeverages(product) {
  const raw = normText(
    [product?.presentacion, product?.nombre, product?.name]
      .filter(Boolean)
      .join(" ")
  );

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

  const m = raw.match(/(?:^|\D)1(?:\D|$)/);
  return m ? 1000 : Number.POSITIVE_INFINITY;
}

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

  const s = raw
    .replace("limón", "limon")
    .replace("tónica", "tonica")
    .replace("sin azúcar", "sin azucar")
    .replace("s/azúcar", "sin azucar")
    .replace("s/azucar", "sin azucar");

  for (const key of FLAVOR_ORDER) {
    if (s.includes(key)) return key;
  }
  return "";
}

function flavorRank(flavor) {
  if (!flavor) return 999;
  const idx = FLAVOR_ORDER.indexOf(flavor);
  return idx >= 0 ? idx : 998;
}

function detectBase(product) {
  const marca = normText(product?.marca);
  if (marca) return marca;

  const raw0 = normText(product?.nombre ?? product?.name);

  const raw = raw0
    .replace(
      /\b\d+(?:\.\d+)?\s*(ml|cc|l|lt|lts|litro|litros|g|gr|grs|kg|kgs|kilo|kilos)\b/g,
      " "
    )
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "otros";

  const tokens = raw.split(" ");
  const two = tokens.slice(0, 2).join(" ");

  if (two === "coca cola") return "coca cola";
  return tokens[0];
}

function sortCatalogue(list) {
  const arr = [...(list || [])];

  arr.sort((a, b) => {
    const catA = getCat(a);
    const catB = getCat(b);
    const catCmp = catA.localeCompare(catB, "es");
    if (catCmp !== 0) return catCmp;

    const baseA = detectBase(a);
    const baseB = detectBase(b);
    const baseCmp = baseA.localeCompare(baseB, "es");
    if (baseCmp !== 0) return baseCmp;

    const flA = detectFlavor(a);
    const flB = detectFlavor(b);
    const frA = flavorRank(flA);
    const frB = flavorRank(flB);
    if (frA !== frB) return frA - frB;

    const ak = parseSizeKey(a);
    const bk = parseSizeKey(b);

    let aV = ak ? ak.value : null;
    let bV = bk ? bk.value : null;

    if (aV == null) aV = fallbackOneLiterForBeverages(a);
    if (bV == null) bV = fallbackOneLiterForBeverages(b);

    if (aV !== bV) return aV - bV;

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
// ✅ Carrusel genérico simple (para "Más vendidos" y "Más nuevos")
// =======================
function renderGenericCarousel(list, frameSelector, trackId, onClick) {
  const frameEl = document.querySelector(frameSelector);
  const trackEl = document.getElementById(trackId);

  if (!frameEl || !trackEl) return; // si no existe en el HTML, no rompe

  trackEl.innerHTML = "";

  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "offers-empty";
    empty.textContent = "Todavía no hay datos para mostrar.";
    frameEl.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  items.forEach((p) => {
    const card = document.createElement("div");
    card.className = "offer-card";
    card.setAttribute("data-id", String(p.id));

    const imgSrc = p.imagen || p.img || "";
    if (imgSrc) {
      const img = document.createElement("img");
      img.className = "offer-img";
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = getName(p);
      img.src = imgSrc;
      card.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "offer-img";
      card.appendChild(ph);
    }

    const body = document.createElement("div");
    body.className = "offer-body";

    const title = document.createElement("p");
    title.className = "offer-title";
    title.textContent = getName(p);

    const price = document.createElement("div");
    price.className = "offer-price";
    const bp = getPrice(p);
    price.textContent = bp > 0 ? formatUYU(bp) : "Consultar";

    body.appendChild(title);
    body.appendChild(price);
    card.appendChild(body);

    if (typeof onClick === "function") {
      card.addEventListener("click", () => onClick(String(p.id)));
    }

    frag.appendChild(card);
  });

  // duplicamos para loop suave si hay 2+
  if (items.length >= 2) {
    items.forEach((p) => {
      const card = document.createElement("div");
      card.className = "offer-card";
      card.setAttribute("data-id", String(p.id));

      const imgSrc = p.imagen || p.img || "";
      if (imgSrc) {
        const img = document.createElement("img");
        img.className = "offer-img";
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = getName(p);
        img.src = imgSrc;
        card.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "offer-img";
        card.appendChild(ph);
      }

      const body = document.createElement("div");
      body.className = "offer-body";

      const title = document.createElement("p");
      title.className = "offer-title";
      title.textContent = getName(p);

      const price = document.createElement("div");
      price.className = "offer-price";
      const bp = getPrice(p);
      price.textContent = bp > 0 ? formatUYU(bp) : "Consultar";

      body.appendChild(title);
      body.appendChild(price);
      card.appendChild(body);

      if (typeof onClick === "function") {
        card.addEventListener("click", () => onClick(String(p.id)));
      }

      frag.appendChild(card);
    });
  }

  trackEl.appendChild(frag);
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
    const totalRaw = computeCartTotal(products, cartObj);
    totalEl.textContent = formatUYU(totalRaw);
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
// ✅ acá es donde “sumamos ventas” al ranking local
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

    // ✅ 1) actualizamos “más vendidos” (por dispositivo)
    bumpSalesFromCart(cart);

    // ✅ 2) re-render del carrusel “más vendidos” (si existe en HTML)
    const best = getTopSoldProducts(products, 10);
    renderGenericCarousel(best, ".bestsellers-frame", "bestsellers-track", goToCatalogAndShowProduct);

    // ✅ 3) enviamos pedido
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

    // ✅ Carrusel OFERTAS (el tuyo)
    const frameEl = document.querySelector(".offers-frame");
    const trackEl = document.getElementById("offers-track");
    renderOffersCarousel(products, frameEl, trackEl, goToCatalogAndShowProduct);

    // ✅ Carrusel MÁS VENDIDOS (si existe en HTML)
    const best = getTopSoldProducts(products, 10);
    renderGenericCarousel(best, ".bestsellers-frame", "bestsellers-track", goToCatalogAndShowProduct);

    // ✅ Carrusel MÁS NUEVOS (si existe en HTML)
    const newest = getNewestProducts(products, 10);
    renderGenericCarousel(newest, ".newest-frame", "newest-track", goToCatalogAndShowProduct);

    rerenderCartUI();

    setTimeout(forceIOSRepaint, 50);
  } catch (err) {
    console.error(err);
    const pc = document.getElementById("products-container");
    if (pc) {
      pc.innerHTML = `<p style="color:#b00020;font-weight:700">Error al cargar productos: ${String(
        err?.message || err
      )}</p>`;
    }
    showProductsMode();
    setTimeout(forceIOSRepaint, 50);
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
