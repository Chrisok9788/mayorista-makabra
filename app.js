// app.js — COMPLETO y MODIFICADO
// ✅ Destacados=TRUE funciona (lee columna "Destacados" desde products.json)
// ✅ Prioriza los marcados (destacado=true). Si una categoría NO tiene marcados, fallback a “2 primeros”.
// ✅ Click en destacado: abre catálogo con categoría/subcat y enfoca el producto
// ✅ Cuando hay filtros activos: OCULTA "Destacados por categoría"
// ✅ Botón ↑ Inicio: sube al buscador sticky y enfoca input
// ✅ Mantiene: FIX iOS, redondeos, categorías/subcategorías, ofertas, carrito, orden inteligente

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
  // acepta $ 1.234, 1234, "1234", etc.
  const v = p?.precio ?? p?.price ?? p?.precio_base ?? p?.precioBase ?? 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;

  const s = String(v ?? "")
    .replace(/\$/g, "")
    .trim()
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function toBool(v) {
  // acepta boolean, "TRUE", "true", "VERDADERO", "1", "SI", "SÍ", "YES"
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").trim().toLowerCase();
  return (
    s === "true" ||
    s === "verdadero" ||
    s === "1" ||
    s === "si" ||
    s === "sí" ||
    s === "yes"
  );
}

function normalizeProduct(p) {
  // ✅ IMPORTANTE: soportar encabezados raros por export (ej: "Destacados " con espacio)
  const dRaw =
    p?.Destacados ??
    p?.destacado ??
    p?.destacados ??
    p?.featured ??
    p?.["Destacados "] ??
    p?.["DESTACADOS"];

  return {
    ...p,
    id: getId(p) || normStr(p?.id),
    nombre: getName(p),
    categoria: getCat(p),
    subcategoria: getSub(p),
    precio: getPrice(p),
    oferta: isOffer(p),
    imagen: getImg(p),

    // ✅ CLAVE: lee tu columna "Destacados"
    destacado: toBool(dRaw),
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

// =======================
// ✅ VISIBILIDAD "DESTACADOS" SEGÚN FILTROS
// =======================
function hasActiveFilters() {
  const q = (document.getElementById("search-input")?.value || "").trim();
  const cat = (document.getElementById("category-filter")?.value || "").trim();
  const sub = (document.getElementById("subcategory-filter")?.value || "").trim();
  return q.length > 0 || cat.length > 0 || sub.length > 0;
}

function setFeaturedVisibility() {
  const featuredSection = document.querySelector(".featured-section");
  if (!featuredSection) return;
  featuredSection.style.display = hasActiveFilters() ? "none" : "";
}

// =======================
// ✅ Scroll util
// =======================
function scrollToCatalogue() {
  const section = document.getElementById("catalogue");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToFiltersAndFocus() {
  const sticky = document.querySelector(".filters-sticky");
  if (sticky) sticky.scrollIntoView({ behavior: "smooth", block: "start" });

  setTimeout(() => {
    const s = document.getElementById("search-input");
    if (s) s.focus({ preventScroll: true });
  }, 250);
}

// =======================
// ✅ Highlight producto al que “lleva”
// =======================
function focusProductCardById(productId) {
  const container = document.getElementById("products-container");
  if (!container) return;

  container.querySelectorAll(".product-card.focused").forEach((el) => {
    el.classList.remove("focused");
  });

  const card =
    container.querySelector(`.product-card[data-id="${CSS.escape(String(productId))}"]`) ||
    container.querySelector(`[data-id="${CSS.escape(String(productId))}"]`);

  if (!card) return;

  card.classList.add("focused");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => card.classList.remove("focused"), 1600);
}

// =======================
// CATEGORÍAS GRID (conteos)
// =======================
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
// ✅ DESTACADOS POR CATEGORÍA (Destacados=TRUE)
//   1) Usa marcados en esa categoría (hasta 2)
//   2) Si esa categoría NO tiene marcados -> fallback a 2 primeros (para no quedar vacía)
// =======================
function pickFeaturedByCategory(allProducts, perCategory = 2) {
  const arr = Array.isArray(allProducts) ? allProducts : [];

  const cats = new Map();
  for (const p of arr) {
    const cat = getCat(p);
    if (!cats.has(cat)) cats.set(cat, []);
    cats.get(cat).push(p);
  }

  const result = [];

  for (const [cat, list] of cats.entries()) {
    const marked = list.filter((p) => p.destacado === true);
    let chosen = marked.slice(0, perCategory);

    if (chosen.length < perCategory) {
      const rest = list.filter((p) => !chosen.includes(p));
      chosen = chosen.concat(rest.slice(0, perCategory - chosen.length));
    }

    result.push([cat, chosen]);
  }

  return result.sort((a, b) => a[0].localeCompare(b[0], "es"));
}

function renderFeaturedByCategory(allProducts, onClickProduct, onViewCategory) {
  const root = document.getElementById("featured-by-category");
  if (!root) return;

  root.innerHTML = "";

  const groups = pickFeaturedByCategory(allProducts, 2);
  if (!groups.length) {
    root.innerHTML = `<div class="offers-empty">No hay productos para mostrar.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();

  groups.forEach(([cat, list]) => {
    const block = document.createElement("div");
    block.className = "featured-cat";

    const head = document.createElement("div");
    head.className = "featured-cat-head";

    const h = document.createElement("h3");
    h.className = "featured-cat-title";
    h.textContent = cat;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost featured-cat-btn";
    btn.textContent = "Ver todo";
    btn.addEventListener("click", () => {
      if (typeof onViewCategory === "function") onViewCategory(cat);
    });

    head.appendChild(h);
    head.appendChild(btn);

    const grid = document.createElement("div");
    grid.className = "featured-grid";

    list.forEach((p) => {
      const card = document.createElement("div");
      card.className = "product-card featured-card";
      card.setAttribute("data-id", String(p.id));

      const badgeLabel =
        typeof p.stock !== "undefined" && p.stock <= 0
          ? "SIN STOCK"
          : p.oferta === true || p.offer === true
          ? "OFERTA"
          : getPrice(p) <= 0
          ? "CONSULTAR"
          : "";

      if (badgeLabel) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = badgeLabel;
        card.appendChild(badge);
      }

      const img = document.createElement("img");
      img.className = "product-image";
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = getName(p);

      const src = getImg(p);
      img.src = src || "./placeholder.png";
      img.onerror = () => {
        img.src = "./placeholder.png";
      };

      card.appendChild(img);

      const content = document.createElement("div");
      content.className = "product-content";

      const title = document.createElement("h3");
      title.textContent = getName(p);

      const price = document.createElement("p");
      price.className = "price";
      const bp = getPrice(p);
      price.textContent =
        typeof p.stock !== "undefined" && p.stock <= 0
          ? "Sin stock"
          : bp > 0
          ? formatUYU(bp)
          : "Consultar";

      const addBtn = document.createElement("button");
      addBtn.className = "btn btn-primary";
      addBtn.type = "button";
      addBtn.textContent = "Agregar";
      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleAdd(p.id);
      });

      content.appendChild(title);
      content.appendChild(price);
      content.appendChild(addBtn);

      card.appendChild(content);

      card.addEventListener("click", () => {
        if (typeof onClickProduct === "function") onClickProduct(String(p.id));
      });

      grid.appendChild(card);
    });

    block.appendChild(head);
    block.appendChild(grid);
    frag.appendChild(block);
  });

  root.appendChild(frag);
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

  setFeaturedVisibility();

  if (!term && !cat && !sub) {
    showCategoriesMode();
    clearProductsUI();
    baseProducts = products;
    return;
  }

  showProductsMode();

  let filtered = products;

  if (cat) filtered = filtered.filter((p) => getCat(p) === cat);
  if (sub) filtered = filtered.filter((p) => getSub(p) === sub);

  if (term) {
    filtered = filterProducts(filtered, "", term);
  }

  filtered = sortCatalogue(filtered);

  renderProducts(filtered, document.getElementById("products-container"), handleAdd);
}

// =======================
// ✅ Navegación desde OFERTAS / DESTACADOS
// =======================
function goToCatalogAndFocusProduct(productId) {
  const prod = products.find((p) => String(p.id) === String(productId));
  if (!prod) return;

  const section = document.getElementById("catalogue");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });

  const searchEl = document.getElementById("search-input");
  if (searchEl) searchEl.value = "";

  const categoryEl = document.getElementById("category-filter");
  const subcatEl = document.getElementById("subcategory-filter");

  if (categoryEl) categoryEl.value = getCat(prod);

  if (subcatEl) {
    const cat = getCat(prod);
    subcatEl.style.display = "block";
    populateSubcategories(products, cat, subcatEl);
    const prodSub = getSub(prod);
    subcatEl.value = prodSub ? prodSub : "";
  }

  applySearchAndFilter();
  setTimeout(() => focusProductCardById(productId), 220);
}

function goToCatalogAndFilterCategory(categoryName) {
  const categoryEl = document.getElementById("category-filter");
  const subcatEl = document.getElementById("subcategory-filter");
  const searchEl = document.getElementById("search-input");

  if (searchEl) searchEl.value = "";
  if (categoryEl) categoryEl.value = categoryName;

  if (subcatEl) {
    subcatEl.style.display = "block";
    populateSubcategories(products, categoryName, subcatEl);
    subcatEl.value = "";
  }

  showProductsMode();
  applySearchAndFilter();
  scrollToCatalogue();
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

    products = normalizeList(raw);
    products = sortCatalogue(products);
    baseProducts = products;

    // ✅ DESTACADOS POR CATEGORÍA (LEE Destacados=TRUE)
    renderFeaturedByCategory(products, goToCatalogAndFocusProduct, goToCatalogAndFilterCategory);

    const categories = buildCategoryCounts(products);
    renderCategoryGrid(categories, (selectedCategory) => {
      const categoryEl = document.getElementById("category-filter");
      const subcatEl = document.getElementById("subcategory-filter");
      const searchEl = document.getElementById("search-input");
      if (searchEl) searchEl.value = "";

      if (categoryEl) categoryEl.value = selectedCategory;

      if (subcatEl) {
        subcatEl.style.display = "block";
        populateSubcategories(products, selectedCategory, subcatEl);
        subcatEl.value = "";
      }

      showProductsMode();
      applySearchAndFilter();
      scrollToCatalogue();
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
        applySearchAndFilter();
        return;
      }

      showProductsMode();

      subcatEl.style.display = "block";
      populateSubcategories(products, cat, subcatEl);
      subcatEl.value = "";

      applySearchAndFilter();
    };

    if (categoryEl) categoryEl.addEventListener("change", refreshSubcats);

    if (subcatEl) {
      subcatEl.addEventListener("change", () => applySearchAndFilter());
    }

    const searchEl = document.getElementById("search-input");
    if (searchEl) {
      searchEl.addEventListener("input", () => {
        if (searchEl.value.trim()) showProductsMode();
        applySearchAndFilter();
      });
    }

    showCategoriesMode();
    clearProductsUI();
    setFeaturedVisibility();

    const frameEl = document.querySelector(".offers-frame");
    const trackEl = document.getElementById("offers-track");
    renderOffersCarousel(products, frameEl, trackEl, goToCatalogAndFocusProduct);

    rerenderCartUI();

    const topBtn = document.getElementById("top-btn") || document.querySelector(".top-float");
    if (topBtn) {
      topBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollToFiltersAndFocus();
      });
    }

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
    setFeaturedVisibility();
    setTimeout(forceIOSRepaint, 50);
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
