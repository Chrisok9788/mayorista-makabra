/*
 * ui.js — MODIFICADO y COMPLETO (performance + compatibilidad)
 *
 * ✅ Mantiene TODO lo básico (redondeos, carrito, dpc.tramos, etc.)
 * ✅ Performance imágenes:
 *   - Carrusel: eager + fetchpriority high
 *   - Catálogo: lazy + decoding async + fetchpriority low
 *   - Placeholder inmediato + fade-in
 *   - Fallback si falla imagen
 *
 * ✅ NUEVO (PROMO MIX por grupo):
 *   - Si el producto tiene promo_group, la promo por cantidad (dpc.tramos)
 *     se calcula con la SUMA de cantidades del carrito dentro del mismo grupo.
 *   - Ej: Budín Romanato (3 sabores) promo_group="romanato_budin_100g"
 *     dpc.tramos: [{min:4, precio:26}] => llevando 4 combinados, todos a $26 c/u.
 *
 * ✅ NUEVO:
 *   - renderFeaturedByCategory (2 artículos por categoría) + callbacks
 *
 * ✅ FIX VERCEL/GH/ANDROID (IMÁGENES):
 *   - resolveAssetUrl(): convierte "images/..." o "/images/..." a una URL válida
 *     respetando import.meta.env.BASE_URL (Vite).
 *
 * ✅ Exporta TODO lo que usa tu app.js:
 *   - renderProducts
 *   - renderCart
 *   - updateCartCount
 *   - populateCategories
 *   - populateSubcategories
 *   - filterProducts
 *   - renderOffersCarousel
 *   - computeCartTotal
 *   - updateCartTotal
 *   - renderCategoryAccordion (opcional)
 *   - renderFeaturedByCategory (nuevo)
 */

/** Convierte precio a número (defensivo) */
function toNumberPrice(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;

  let s = String(v).trim();
  s = s.replace(/\$/g, "").trim();
  s = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** ✅ Redondeo UYU: 369.5 => 370 */
function roundUYU(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x) : 0;
}

/** Nombre soportando ambos formatos */
function getProductName(p) {
  return String(p?.nombre ?? p?.name ?? "").trim();
}

/** Precio base soportando ambos formatos */
function getBasePrice(p) {
  return toNumberPrice(p?.precio ?? p?.price);
}

/** Promo group (mix) */
function getPromoGroup(p) {
  const g = String(p?.promo_group ?? p?.promoGroup ?? p?.grupo_promo ?? "").trim();
  return g || "";
}

/**
 * Devuelve el precio unitario aplicando promo por cantidad (si existe).
 * Espera: product.dpc.tramos = [{min, max, precio}, ...]
 * NOTA: qty aquí puede ser la qty del item o la qty del grupo (mix).
 */
function getUnitPriceByQty(product, qty) {
  const base = getBasePrice(product);

  const tramos = product?.dpc?.tramos;
  if (!Array.isArray(tramos) || tramos.length === 0) return base;

  for (const t of tramos) {
    const min = Number(t?.min);
    const max = Number(t?.max);
    const precio = toNumberPrice(t?.precio);

    if (!Number.isFinite(min) || min <= 0) continue;

    const maxOk = Number.isFinite(max) && max > 0 ? max : Number.POSITIVE_INFINITY;

    if (qty >= min && qty <= maxOk) {
      return precio > 0 ? precio : base;
    }
  }

  return base;
}

/**
 * Arma el texto de promo por cantidad:
 * - normal: "Llevando 5 rebaja a $65 c/u"
 * - mix:    "Llevando 4 (combinables) rebaja a $26 c/u"
 */
function getQtyPromoText(product) {
  const tramos = product?.dpc?.tramos;
  if (!Array.isArray(tramos) || tramos.length === 0) return "";

  const isMix = !!getPromoGroup(product);

  for (const t of tramos) {
    const min = Number(t?.min);
    const precio = toNumberPrice(t?.precio);

    if (Number.isFinite(min) && min > 0 && precio > 0) {
      return isMix
        ? `Llevando ${min} (combinables) rebaja a $${roundUYU(precio)} c/u`
        : `Llevando ${min} rebaja a $${roundUYU(precio)} c/u`;
    }
  }
  return "";
}

/** ✅ Formatea $ 1234 (redondeado) */
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return `$ ${roundUYU(v)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

/**
 * @param {Record<string, any>} product
 * @returns {string}
 */
function buildProductCardHtml(product) {
  const id = String(product?.id ?? "");

  let badgeLabel = "";
  let badgeClass = "";

  if (typeof product.stock !== "undefined" && product.stock <= 0) {
    badgeLabel = "SIN STOCK";
    badgeClass = "sin-stock";
  } else if (product.oferta === true || product.offer === true) {
    badgeLabel = "OFERTA";
    badgeClass = "oferta";
  } else if (getBasePrice(product) <= 0) {
    badgeLabel = "CONSULTAR";
    badgeClass = "consultar";
  }

  const metaParts = [product.marca, product.presentacion]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);

  if (!metaParts.length && product.categoria) metaParts.push(String(product.categoria));

  const basePrice = getBasePrice(product);
  const priceText =
    typeof product.stock !== "undefined" && product.stock <= 0
      ? "Sin stock"
      : basePrice > 0
        ? money(basePrice)
        : "Consultar";

  const promoText = getQtyPromoText(product);

  return `
    <article class="product-card" data-id="${escapeAttr(id)}">
      ${badgeLabel ? `<span class="badge ${escapeAttr(badgeClass)}">${escapeHtml(badgeLabel)}</span>` : ""}
      <img class="product-image" alt="${escapeAttr(getProductName(product) || "Producto")}" data-product-image="${escapeAttr(id)}">
      <div class="product-content">
        <h3>${escapeHtml(getProductName(product) || "Producto")}</h3>
        ${metaParts.length ? `<div class="meta">${escapeHtml(metaParts.join(" · "))}</div>` : ""}
        <p class="price">${escapeHtml(priceText)}</p>
        ${promoText ? `<div class="price-note">${escapeHtml(promoText)}</div>` : ""}
        <button class="btn btn-primary" data-add-to-cart="${escapeAttr(id)}" type="button">Agregar al carrito</button>
      </div>
    </article>`;
}

/**
 * @param {HTMLElement} container
 * @param {Map<string, Record<string, any>>} byId
 */
function hydrateProductImages(container, byId) {
  container.querySelectorAll("img[data-product-image]").forEach((img) => {
    const id = img.getAttribute("data-product-image") || "";
    const product = byId.get(id);
    if (!product) return;

    setupFastImage(img, product.imagen || product.img || "", getProductName(product) || "Producto", {
      priority: "low",
      loading: "lazy",
    });
  });
}

/**
 * @param {HTMLElement} container
 * @param {(productId: string) => void} [addHandler]
 */
function bindProductActions(container, addHandler) {
  container.querySelectorAll("button[data-add-to-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add-to-cart");
      if (id) addHandler && addHandler(id);
      btn.classList.add("btn-tap");
      setTimeout(() => btn.classList.remove("btn-tap"), 100);
    });
  });
}

/**
 * @param {Record<string, any>} product
 * @param {number} quantity
 * @param {Map<string, number>} groupQtyMap
 * @returns {string}
 */
function buildCartItemHtml(product, quantity, groupQtyMap) {
  const id = String(product?.id ?? "").trim();
  const q = Number(quantity) || 0;
  const promoText = getQtyPromoText(product);
  const group = getPromoGroup(product);
  const mixQty = group ? groupQtyMap.get(group) || 0 : 0;

  const effQty = getEffectiveQtyForPricing(product, q, groupQtyMap);
  const unitRaw = getUnitPriceByQty(product, effQty);
  const calcText =
    unitRaw > 0
      ? `${q} x $ ${roundUYU(unitRaw)} = $ ${roundUYU(unitRaw * q)}`
      : "Consultar";

  return `
    <div class="cart-item" style="position:relative">
      <div>
        <div class="cart-item-name">${escapeHtml(getProductName(product) || "Producto")}</div>
        ${promoText ? `<div class="cart-item-note">${escapeHtml(promoText)}</div>` : ""}
        ${group ? `<div class="cart-item-note" style="opacity:.85">${escapeHtml(`Combinados del grupo: ${mixQty}`)}</div>` : ""}
      </div>
      <div class="cart-item-calc">${escapeHtml(calcText)}</div>
      <div class="cart-item-controls">
        <button type="button" data-cart-op="minus" data-id="${escapeAttr(id)}">−</button>
        <input type="number" min="1" value="${escapeAttr(q)}" data-cart-op="input" data-id="${escapeAttr(id)}">
        <button type="button" data-cart-op="plus" data-id="${escapeAttr(id)}">+</button>
        <button type="button" data-cart-op="remove" data-id="${escapeAttr(id)}">✖</button>
      </div>
    </div>`;
}

/**
 * @param {HTMLElement} container
 * @param {Record<string, number>} cart
 * @param {(id: string, qty: number) => void} [updateHandler]
 * @param {(id: string) => void} [removeHandler]
 */
function bindCartActions(container, cart, updateHandler, removeHandler) {
  container.querySelectorAll("[data-cart-op]").forEach((node) => {
    const op = node.getAttribute("data-cart-op");
    const id = node.getAttribute("data-id") || "";
    const currentQty = Number(cart?.[id]) || 0;
    if (!id) return;

    if (op === "minus") node.addEventListener("click", () => updateHandler && updateHandler(id, currentQty - 1));
    if (op === "plus") node.addEventListener("click", () => updateHandler && updateHandler(id, currentQty + 1));
    if (op === "remove") node.addEventListener("click", () => removeHandler && removeHandler(id));
    if (op === "input") {
      node.addEventListener("change", (e) => {
        const value = parseInt(e.target.value, 10);
        updateHandler && updateHandler(id, Number.isNaN(value) ? 1 : Math.max(1, value));
      });
    }
  });
}

/** Base URL defensivo */
function getBaseUrl() {
  const BASE =
    typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL
      ? String(import.meta.env.BASE_URL)
      : "./";

  // Asegura que termine en "/"
  return BASE.endsWith("/") ? BASE : `${BASE}/`;
}

/** Placeholder defensivo (puede ser placeholder.png) */
function getPlaceholderUrl() {
  return `${getBaseUrl()}placeholder.png`;
}

/**
 * ✅ FIX VERCEL/GH/ANDROID:
 * Convierte rutas relativas o root-relative en una ruta válida respetando BASE_URL.
 * - "images/x.jpg"   => BASE_URL + "images/x.jpg"
 * - "/images/x.jpg"  => BASE_URL + "images/x.jpg"  (IMPORTANTE para GH Pages)
 * - "./images/x.jpg" => BASE_URL + "images/x.jpg"
 * - "http..."        => se deja tal cual
 */
function resolveAssetUrl(src) {
  const s = String(src || "").trim();
  if (!s) return "";

  // absolutas o especiales: no tocar
  if (/^(https?:)?\/\//i.test(s) || /^data:/i.test(s) || /^blob:/i.test(s)) return s;

  // normaliza prefijos
  const clean = s.replace(/^\.?\//, "").replace(/^\/+/, "");

  return `${getBaseUrl()}${clean}`;
}

/**
 * ✅ Aplica “carga rápida” a imágenes:
 * - placeholder inmediato
 * - prioridad configurable
 * - lazy/eager configurable
 * - decode async
 * - fade-in cuando carga
 * - ✅ FIX: resuelve URL final con BASE_URL
 */
function setupFastImage(imgEl, realSrc, alt, opts = {}) {
  const { priority = "low", loading = "lazy", width, height } = opts;

  const placeholder = getPlaceholderUrl();

  if (width) imgEl.width = width;
  if (height) imgEl.height = height;

  imgEl.alt = alt || "Producto";

  imgEl.src = placeholder;

  imgEl.loading = loading;
  imgEl.decoding = "async";
  imgEl.setAttribute("fetchpriority", priority);

  imgEl.style.opacity = "0";
  imgEl.style.transition = "opacity 160ms ease";

  const finalSrc = resolveAssetUrl(realSrc);
  if (!finalSrc) {
    imgEl.style.opacity = "1";
    return;
  }

  imgEl.onload = () => {
    imgEl.style.opacity = "1";
  };

  imgEl.onerror = () => {
    imgEl.src = placeholder;
    imgEl.style.opacity = "1";
  };

  if (typeof queueMicrotask === "function") {
    queueMicrotask(() => {
      imgEl.src = finalSrc;
    });
  } else {
    setTimeout(() => {
      imgEl.src = finalSrc;
    }, 0);
  }
}

/* =========================
   ✅ PROMO MIX: utilidades
   ========================= */

/** Crea mapa id->producto */
function mapById(products) {
  return new Map((products || []).map((p) => [String(p?.id ?? "").trim(), p]));
}

/** Suma cantidades por promo_group (mix) usando el carrito actual */
function buildGroupQtyMap(products, cart) {
  const byId = mapById(products);
  const groupQty = new Map();

  for (const [rawId, rawQty] of Object.entries(cart || {})) {
    const id = String(rawId ?? "").trim();
    const qty = Number(rawQty) || 0;
    if (!id || qty < 1) continue;

    const p = byId.get(id);
    if (!p) continue;

    const g = getPromoGroup(p);
    if (!g) continue;

    groupQty.set(g, (groupQty.get(g) || 0) + qty);
  }

  return groupQty;
}

/** Qty efectiva: si hay promo_group, usa qty del grupo; si no, usa qty del ítem */
function getEffectiveQtyForPricing(product, itemQty, groupQtyMap) {
  const g = getPromoGroup(product);
  if (!g) return itemQty;
  const qg = groupQtyMap?.get(g);
  return Number(qg) > 0 ? Number(qg) : itemQty;
}

/* =========================
   Totales carrito
   ========================= */

export function computeCartTotal(products, cart) {
  if (!Array.isArray(products) || !products.length) return 0;
  if (!cart || typeof cart !== "object") return 0;

  const byId = mapById(products);
  const groupQtyMap = buildGroupQtyMap(products, cart);

  let total = 0;

  for (const [rawId, rawQty] of Object.entries(cart)) {
    const id = String(rawId ?? "").trim();
    const qty = Number(rawQty) || 0;
    if (!id || qty < 1) continue;

    const p = byId.get(id);
    if (!p) continue;

    const effQty = getEffectiveQtyForPricing(p, qty, groupQtyMap);
    const unit = getUnitPriceByQty(p, effQty);
    if (unit <= 0) continue;

    total += roundUYU(unit * qty);
  }

  return total;
}

export function updateCartTotal(totalEl, products, cart) {
  if (!totalEl) return;
  const total = computeCartTotal(products, cart);
  totalEl.textContent = money(total);
}

/* =========================
   Catálogo
   ========================= */

export function renderProducts(list, container, addHandler) {
  if (!container) return;
  container.innerHTML = "";

  if (!list || !list.length) {
    container.innerHTML = "<p>No se encontraron productos.</p>";
    return;
  }

  const byId = new Map();
  const html = list
    .map((product) => {
      byId.set(String(product?.id ?? ""), product);
      return buildProductCardHtml(product);
    })
    .join("");

  container.innerHTML = html;
  hydrateProductImages(container, byId);
  bindProductActions(container, addHandler);
}

/* =========================
   Carrusel ofertas
   ========================= */

export function renderOffersCarousel(products, frameEl, trackEl, onClick) {
  if (!frameEl || !trackEl) return;

  trackEl.innerHTML = "";
  const prevEmpty = frameEl.querySelector(".offers-empty");
  if (prevEmpty) prevEmpty.remove();

  const offers = (products || []).filter((p) => {
    const hasStockInfo = typeof p.stock !== "undefined";
    const inStock = !hasStockInfo || p.stock > 0;
    const isOffer = p.oferta === true || p.offer === true;
    return isOffer && inStock;
  });

  if (offers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "offers-empty";
    empty.textContent = "No hay ofertas cargadas.";
    frameEl.appendChild(empty);
    return;
  }

  const makeCard = (p) => {
    const card = document.createElement("div");
    card.className = "offer-card";
    card.setAttribute("data-id", String(p.id ?? ""));

    const name = getProductName(p) || "Producto";
    const imgSrc = p.imagen || p.img || "";

    if (imgSrc) {
      const img = document.createElement("img");
      img.className = "offer-img";

      setupFastImage(img, imgSrc, name, {
        priority: "high",
        loading: "eager",
      });

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
    title.textContent = name;

    const bp = getBasePrice(p);
    const price = document.createElement("div");
    price.className = "offer-price";
    price.textContent = bp > 0 ? money(bp) : "Consultar";

    body.appendChild(title);
    body.appendChild(price);

    const promo = getQtyPromoText(p);
    if (promo) {
      const note = document.createElement("div");
      note.className = "offer-note";
      note.textContent = promo;
      body.appendChild(note);
    }

    card.appendChild(body);

    if (typeof onClick === "function") {
      card.addEventListener("click", () => {
        const id = card.getAttribute("data-id");
        if (id) onClick(id);
      });
    }

    return card;
  };

  const frag = document.createDocumentFragment();
  offers.forEach((p) => frag.appendChild(makeCard(p)));

  if (offers.length >= 2) {
    offers.forEach((p) => frag.appendChild(makeCard(p)));
  }

  trackEl.appendChild(frag);
}

/* =========================
   Carrito
   ========================= */

export function renderCart(products, cart, container, updateHandler, removeHandler) {
  if (!container) return 0;
  container.innerHTML = "";

  const entries = Object.entries(cart || {});
  if (!entries.length) {
    container.innerHTML = "<p>Tu carrito está vacío.</p>";
    return 0;
  }

  const byId = mapById(products || []);
  const groupQtyMap = buildGroupQtyMap(products || [], cart || {});

  const rows = [];

  entries.forEach(([productId, qty]) => {
    const id = String(productId ?? "").trim();
    const q = Number(qty) || 0;
    if (!id || q < 1) return;

    const product = byId.get(id);
    if (!product) return;

    rows.push(buildCartItemHtml(product, q, groupQtyMap));
  });

  container.innerHTML = rows.join("");
  bindCartActions(container, cart || {}, updateHandler, removeHandler);

  return computeCartTotal(products, cart);
}

/** Contador carrito */
export function updateCartCount(countEl, count) {
  if (!countEl) return;
  countEl.textContent = count;
}

/* =========================
   Filtros / categorías
   ========================= */

export function populateCategories(products, select) {
  if (!select) return;

  const keepFirst = select.querySelector('option[value=""]');
  select.innerHTML = "";
  if (keepFirst) select.appendChild(keepFirst);
  else {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Todas las categorías";
    select.appendChild(opt);
  }

  const categories = Array.from(
    new Set(
      (products || [])
        .map((p) => (p.categoria || p.category || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));

  categories.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

export function populateSubcategories(products, category, select) {
  if (!select) return;

  select.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Todas las subcategorías";
  select.appendChild(opt0);

  const subs = Array.from(
    new Set(
      (products || [])
        .filter((p) => (p.categoria || p.category || "").trim() === category)
        .map((p) => (p.subcategoria || p.subcategory || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));

  subs.forEach((sub) => {
    const opt = document.createElement("option");
    opt.value = sub;
    opt.textContent = sub;
    select.appendChild(opt);
  });
}

export function filterProducts(products, category, searchTerm) {
  let result = products || [];

  if (category) {
    result = result.filter((p) => (p.categoria || p.category || "").trim() === category);
  }

  if (searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    result = result.filter((p) => {
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const text = [
        getProductName(p),
        p.marca || "",
        (p.categoria || p.category || ""),
        (p.subcategoria || p.subcategory || ""),
        tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(term);
    });
  }

  return result;
}

/* =========================
   Panel acordeón (opcional)
   ========================= */

export function renderCategoryAccordion(products, onSelect) {
  const accordion = document.getElementById("categoryAccordion");
  if (!accordion) return;
  accordion.innerHTML = "";

  const allProducts = Array.isArray(products) ? products : [];

  const catMap = new Map();
  for (const p of allProducts) {
    const cat = (p.categoria || p.category || "Otros").trim();
    const sub = (p.subcategoria || p.subcategory || "Otros").trim();
    if (!catMap.has(cat)) catMap.set(cat, new Map());
    const subMap = catMap.get(cat);
    if (!subMap.has(sub)) subMap.set(sub, []);
    subMap.get(sub).push(p);
  }

  const categories = Array.from(catMap.keys()).sort((a, b) => a.localeCompare(b, "es"));

  const title = document.createElement("div");
  title.className = "cat-panel-head";
  title.innerHTML = `<strong>Filtrar</strong>`;
  accordion.appendChild(title);

  const renderCategoriesList = () => {
    accordion.innerHTML = "";
    accordion.appendChild(title);

    const list = document.createElement("div");
    list.className = "cat-list";

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "cat-pill";
    allBtn.textContent = "Ver todo";
    allBtn.onclick = () => typeof onSelect === "function" && onSelect(allProducts);
    list.appendChild(allBtn);

    categories.forEach((cat) => {
      const subMap = catMap.get(cat);
      const count = Array.from(subMap.values()).reduce((a, arr) => a + arr.length, 0);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "accordion-btn";
      btn.innerHTML = `<span>${escapeHtml(cat)}</span><span class="chev">▾</span><small style="opacity:.7;margin-left:auto">${count}</small>`;
      btn.onclick = () => renderSubcategories(cat);
      list.appendChild(btn);
    });

    accordion.appendChild(list);
  };

  const renderSubcategories = (cat) => {
    const subMap = catMap.get(cat) || new Map();

    accordion.innerHTML = "";
    accordion.appendChild(title);

    const head = document.createElement("div");
    head.className = "subcats-head";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn";
    back.textContent = "← Volver a categorías";
    back.onclick = () => renderCategoriesList();

    const h = document.createElement("div");
    h.style.fontWeight = "800";
    h.style.marginTop = "10px";
    h.textContent = cat;

    head.appendChild(back);
    head.appendChild(h);

    const subSearch = document.createElement("input");
    subSearch.type = "text";
    subSearch.placeholder = "Buscar subcategoría...";
    subSearch.className = "subcat-search";

    accordion.appendChild(head);
    accordion.appendChild(subSearch);

    const body = document.createElement("div");
    body.className = "accordion-body open";

    const allCat = document.createElement("div");
    allCat.className = "subcat";
    const totalCount = Array.from(subMap.values()).reduce((a, arr) => a + arr.length, 0);
    allCat.innerHTML = `<span>Ver toda la categoría</span><small>${totalCount}</small>`;
    allCat.onclick = () => {
      const list = [];
      for (const arr of subMap.values()) list.push(...arr);
      typeof onSelect === "function" && onSelect(list);
    };
    body.appendChild(allCat);

    const renderSubList = (term = "") => {
      body.querySelectorAll(".subcat.row").forEach((n) => n.remove());

      const t = term.trim().toLowerCase();
      const subs = Array.from(subMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0], "es"))
        .filter(([sub]) => !t || sub.toLowerCase().includes(t));

      subs.forEach(([sub, arr]) => {
        const row = document.createElement("div");
        row.className = "subcat row";
        row.innerHTML = `<span>${escapeHtml(sub)}</span><small>${arr.length}</small>`;
        row.onclick = () => typeof onSelect === "function" && onSelect(arr);
        body.appendChild(row);
      });

      if (subs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "offers-empty sub-empty";
        empty.textContent = "No hay subcategorías que coincidan.";
        empty.style.marginTop = "8px";
        body.querySelectorAll(".sub-empty").forEach((n) => n.remove());
        body.appendChild(empty);
      } else {
        body.querySelectorAll(".sub-empty").forEach((n) => n.remove());
      }
    };

    renderSubList("");

    subSearch.addEventListener("input", () => {
      renderSubList(subSearch.value);
    });

    accordion.appendChild(body);
  };

  renderCategoriesList();
}

/* =========================
   ✅ DESTACADOS (2 por categoría)
   ========================= */

export function renderFeaturedByCategory(products, options = {}) {
  const {
    rootId = "featured-by-category",
    perCategory = 2,
    onClickProduct,
    onViewCategory,
    onAddToCart,
  } = options;

  const root = document.getElementById(rootId);
  if (!root) return;

  const list = Array.isArray(products) ? products : [];
  root.innerHTML = "";

  if (!list.length) {
    root.innerHTML = `<div class="offers-empty">No hay productos para mostrar.</div>`;
    return;
  }

  const map = new Map();
  for (const p of list) {
    const cat = String(p?.categoria ?? p?.category ?? "Otros").trim() || "Otros";
    if (!map.has(cat)) map.set(cat, []);
    const arr = map.get(cat);
    if (arr.length < perCategory) arr.push(p);
  }

  const groups = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "es"));

  const frag = document.createDocumentFragment();

  groups.forEach(([cat, items]) => {
    const section = document.createElement("section");
    section.className = "featured-cat";

    const head = document.createElement("div");
    head.className = "featured-cat-head";

    const title = document.createElement("h3");
    title.className = "featured-cat-title";
    title.textContent = cat;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost featured-cat-btn";
    btn.textContent = "Ver todo";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onViewCategory === "function") onViewCategory(cat);
    });

    head.appendChild(title);
    head.appendChild(btn);
    section.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "featured-grid";

    items.forEach((p) => {
      const card = document.createElement("div");
      card.className = "product-card featured-card";
      card.dataset.id = String(p?.id ?? "");

      let badgeLabel = "";
      let badgeClass = "";

      if (typeof p.stock !== "undefined" && p.stock <= 0) {
        badgeLabel = "SIN STOCK";
        badgeClass = "sin-stock";
      } else if (p.oferta === true || p.offer === true) {
        badgeLabel = "OFERTA";
        badgeClass = "oferta";
      } else if (getBasePrice(p) <= 0) {
        badgeLabel = "CONSULTAR";
        badgeClass = "consultar";
      }

      if (badgeLabel) {
        const badge = document.createElement("span");
        badge.className = `badge ${badgeClass}`;
        badge.textContent = badgeLabel;
        card.appendChild(badge);
      }

      const img = document.createElement("img");
      img.className = "product-image";
      const imgSrc = p.imagen || p.img || "";
      setupFastImage(img, imgSrc, getProductName(p) || "Producto", {
        priority: "low",
        loading: "lazy",
      });
      card.appendChild(img);

      const content = document.createElement("div");
      content.className = "product-content";

      const h3 = document.createElement("h3");
      h3.textContent = getProductName(p) || "Producto";

      const price = document.createElement("p");
      price.className = "price";

      const bp = getBasePrice(p);
      if (typeof p.stock !== "undefined" && p.stock <= 0) price.textContent = "Sin stock";
      else if (bp > 0) price.textContent = money(bp);
      else price.textContent = "Consultar";

      content.appendChild(h3);
      content.appendChild(price);

      const promoText = getQtyPromoText(p);
      if (promoText) {
        const note = document.createElement("div");
        note.className = "price-note";
        note.textContent = promoText;
        content.appendChild(note);
      }

      const addBtn = document.createElement("button");
      addBtn.className = "btn btn-primary";
      addBtn.type = "button";
      addBtn.textContent = "Agregar al carrito";
      addBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onAddToCart === "function") onAddToCart(p.id);
        addBtn.classList.add("btn-tap");
        setTimeout(() => addBtn.classList.remove("btn-tap"), 100);
      });

      content.appendChild(addBtn);
      card.appendChild(content);

      card.addEventListener("click", () => {
        if (typeof onClickProduct === "function") onClickProduct(String(p.id));
      });

      grid.appendChild(card);
    });

    section.appendChild(grid);
    frag.appendChild(section);
  });

  root.appendChild(frag);
}
