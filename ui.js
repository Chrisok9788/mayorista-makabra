/*
 * ui.js — MODIFICADO y COMPLETO (performance + compatibilidad)
 *
 * ✅ Mantiene TODO lo base (redondeos, carrito, dpc.tramos, etc.)
 * ✅ Performance imágenes:
 *   - Carrusel: eager + fetchpriority high
 *   - Catálogo: lazy + decoding async + fetchpriority low
 *   - Placeholder inmediato + fade-in
 *   - Fallback si falla imagen
 *
 * ✅ NUEVO:
 *   - renderFeaturedByCategory (2 artículos por categoría) + callbacks:
 *     onClickProduct / onViewCategory / onAddToCart (opcional)
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

/**
 * Devuelve el precio unitario aplicando promo por cantidad (si existe).
 * Espera: product.dpc.tramos = [{min, max, precio}, ...]
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

    // max puede venir null / 0 / 999999 -> lo tratamos como "sin tope"
    const maxOk = Number.isFinite(max) && max > 0 ? max : Number.POSITIVE_INFINITY;

    if (qty >= min && qty <= maxOk) {
      return precio > 0 ? precio : base;
    }
  }

  return base;
}

/**
 * Arma el texto de promo por cantidad:
 * "Llevando 5 rebaja a $65 c/u"
 * ✅ Precio redondeado para evitar $30.8333
 */
function getQtyPromoText(product) {
  const tramos = product?.dpc?.tramos;
  if (!Array.isArray(tramos) || tramos.length === 0) return "";

  for (const t of tramos) {
    const min = Number(t?.min);
    const precio = toNumberPrice(t?.precio);

    if (Number.isFinite(min) && min > 0 && precio > 0) {
      return `Llevando ${min} rebaja a $${roundUYU(precio)} c/u`;
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

/** Base URL defensivo */
function getBaseUrl() {
  const BASE =
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.BASE_URL
      ? import.meta.env.BASE_URL
      : "./";
  return BASE;
}

/** Placeholder defensivo (puede ser placeholder.png) */
function getPlaceholderUrl() {
  return `${getBaseUrl()}placeholder.png`;
}

/**
 * ✅ Aplica “carga rápida” a imágenes:
 * - placeholder inmediato
 * - prioridad configurable
 * - lazy/eager configurable
 * - decode async
 * - fade-in cuando carga
 */
function setupFastImage(imgEl, realSrc, alt, opts = {}) {
  const {
    priority = "low", // "high" para carrusel
    loading = "lazy", // "eager" para carrusel
    width,
    height,
  } = opts;

  const placeholder = getPlaceholderUrl();

  // atributos “baratos” primero (para evitar layout raro)
  if (width) imgEl.width = width;
  if (height) imgEl.height = height;

  imgEl.alt = alt || "Producto";

  // placeholder ya
  imgEl.src = placeholder;

  // mejoras de performance
  imgEl.loading = loading; // lazy / eager
  imgEl.decoding = "async"; // decode sin trabar UI
  imgEl.setAttribute("fetchpriority", priority); // "high" / "low"

  // fade-in
  imgEl.style.opacity = "0";
  imgEl.style.transition = "opacity 160ms ease";

  const finalSrc = realSrc || "";
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

  // setear src real en un tick (mejor primera pintura)
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

/**
 * Calcula total del carrito aplicando promos por cantidad si existen.
 * ✅ COHERENTE: suma subtotales ya redondeados (igual que WhatsApp).
 *
 * @param {Array} products
 * @param {Object} cart (id -> qty)
 */
export function computeCartTotal(products, cart) {
  if (!Array.isArray(products) || !products.length) return 0;
  if (!cart || typeof cart !== "object") return 0;

  const byId = new Map(products.map((p) => [String(p.id ?? "").trim(), p]));

  let total = 0;

  for (const [rawId, rawQty] of Object.entries(cart)) {
    const id = String(rawId ?? "").trim();
    const qty = Number(rawQty) || 0;
    if (!id || qty < 1) continue;

    const p = byId.get(id);
    if (!p) continue;

    const unit = getUnitPriceByQty(p, qty);
    if (unit <= 0) continue; // consultables no suman

    const subtotalExact = unit * qty;
    const subtotalRounded = roundUYU(subtotalExact);

    total += subtotalRounded;
  }

  return total;
}

/**
 * Actualiza el total en pantalla.
 */
export function updateCartTotal(totalEl, products, cart) {
  if (!totalEl) return;
  const total = computeCartTotal(products, cart);
  totalEl.textContent = money(total);
}

/**
 * Renderiza la lista de productos en un contenedor.
 * ✅ Mejoras: lazy + async decode + placeholder + fade-in
 */
export function renderProducts(list, container, addHandler) {
  if (!container) return;
  container.innerHTML = "";

  if (!list || !list.length) {
    container.innerHTML = "<p>No se encontraron productos.</p>";
    return;
  }

  list.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";

    // BADGE
    let badgeLabel = "";
    let badgeClass = "";

    if (typeof product.stock !== "undefined" && product.stock <= 0) {
      badgeLabel = "SIN STOCK";
      badgeClass = "sin-stock";
    } else if (product.oferta === true || product.offer === true) {
      badgeLabel = "OFERTA";
      badgeClass = "oferta";
    } else {
      const bp = getBasePrice(product);
      if (bp <= 0) {
        badgeLabel = "CONSULTAR";
        badgeClass = "consultar";
      }
    }

    if (badgeLabel) {
      const badge = document.createElement("span");
      badge.className = `badge ${badgeClass}`;
      badge.textContent = badgeLabel;
      card.appendChild(badge);
    }

    // IMAGEN (catálogo: low + lazy)
    const img = document.createElement("img");
    img.className = "product-image";

    const imgSrc = product.imagen || product.img || "";
    setupFastImage(img, imgSrc, getProductName(product) || "Producto", {
      priority: "low",
      loading: "lazy",
    });

    card.appendChild(img);

    // CONTENIDO
    const content = document.createElement("div");
    content.className = "product-content";

    const title = document.createElement("h3");
    title.textContent = getProductName(product) || "Producto";
    content.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";

    if (product.marca) meta.appendChild(document.createTextNode(product.marca));

    if (product.presentacion) {
      if (meta.childNodes.length) meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(document.createTextNode(product.presentacion));
    }

    if (!meta.childNodes.length && product.categoria) {
      meta.appendChild(document.createTextNode(product.categoria));
    }

    if (meta.childNodes.length) content.appendChild(meta);

    // PRECIO
    const price = document.createElement("p");
    price.className = "price";

    const basePrice = getBasePrice(product);

    if (product.stock !== undefined && product.stock <= 0) {
      price.textContent = "Sin stock";
    } else if (basePrice > 0) {
      price.textContent = money(basePrice);
    } else {
      price.textContent = "Consultar";
    }
    content.appendChild(price);

    // PROMO POR CANTIDAD
    const promoText = getQtyPromoText(product);
    if (promoText) {
      const note = document.createElement("div");
      note.className = "price-note";
      note.textContent = promoText;
      content.appendChild(note);
    }

    // BOTÓN
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Agregar al carrito";

    btn.addEventListener("click", () => {
      addHandler && addHandler(product.id);
      btn.classList.add("btn-tap");
      setTimeout(() => btn.classList.remove("btn-tap"), 100);
    });

    content.appendChild(btn);

    card.appendChild(content);
    container.appendChild(card);
  });
}

/**
 * Renderiza el carrusel de OFERTAS.
 * ✅ Mejora: imágenes eager + prioridad alta para que “salga primero”
 */
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

  // duplicamos si hay 2+ para loop continuo
  if (offers.length >= 2) {
    offers.forEach((p) => frag.appendChild(makeCard(p)));
  }

  trackEl.appendChild(frag);
}

/**
 * Renderiza el carrito con:
 * - Nombre + promo
 * - Arriba a la derecha: "Q x $Unit = $Total"
 *
 * ✅ Unit y Total redondeados
 */
export function renderCart(products, cart, container, updateHandler, removeHandler) {
  if (!container) return 0;
  container.innerHTML = "";

  const entries = Object.entries(cart || {});
  if (!entries.length) {
    container.innerHTML = "<p>Tu carrito está vacío.</p>";
    return 0;
  }

  const byId = new Map((products || []).map((p) => [String(p.id ?? "").trim(), p]));

  entries.forEach(([productId, qty]) => {
    const id = String(productId ?? "").trim();
    const q = Number(qty) || 0;
    if (!id || q < 1) return;

    const product = byId.get(id);
    if (!product) return;

    const item = document.createElement("div");
    item.className = "cart-item";
    item.style.position = "relative";

    const left = document.createElement("div");

    const name = document.createElement("div");
    name.className = "cart-item-name";
    name.textContent = getProductName(product) || "Producto";
    left.appendChild(name);

    const promoText = getQtyPromoText(product);
    if (promoText) {
      const note = document.createElement("div");
      note.className = "cart-item-note";
      note.textContent = promoText;
      left.appendChild(note);
    }

    item.appendChild(left);

    // ✅ cálculo arriba derecha
    const unitRaw = getUnitPriceByQty(product, q);

    const calc = document.createElement("div");
    calc.className = "cart-item-calc";
    if (unitRaw > 0) {
      const unitShow = roundUYU(unitRaw);
      const rowTotalShow = roundUYU(unitRaw * q);
      calc.textContent = `${q} x $ ${unitShow} = $ ${rowTotalShow}`;
    } else {
      calc.textContent = "Consultar";
    }
    item.appendChild(calc);

    // Controles
    const controls = document.createElement("div");
    controls.className = "cart-item-controls";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.onclick = () => updateHandler && updateHandler(id, q - 1);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.value = q;
    input.onchange = (e) => {
      const v = parseInt(e.target.value, 10);
      const safe = isNaN(v) ? 1 : Math.max(1, v);
      updateHandler && updateHandler(id, safe);
    };

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.onclick = () => updateHandler && updateHandler(id, q + 1);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✖";
    remove.onclick = () => removeHandler && removeHandler(id);

    controls.append(minus, input, plus, remove);
    item.appendChild(controls);

    container.appendChild(item);
  });

  return computeCartTotal(products, cart);
}

/**
 * Actualiza contador carrito.
 */
export function updateCartCount(countEl, count) {
  if (!countEl) return;
  countEl.textContent = count;
}

/**
 * Carga categorías únicas en el select.
 */
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

/**
 * Carga subcategorías en el select, según categoría elegida.
 */
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

/**
 * Filtra por categoría y texto.
 */
export function filterProducts(products, category, searchTerm) {
  let result = products || [];

  if (category) {
    result = result.filter(
      (p) => (p.categoria || p.category || "").trim() === category
    );
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

/**
 * Panel tipo acordeón (opcional).
 */
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

  const categories = Array.from(catMap.keys()).sort((a, b) =>
    a.localeCompare(b, "es")
  );

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
      btn.innerHTML = `<span>${cat}</span><span class="chev">▾</span><small style="opacity:.7;margin-left:auto">${count}</small>`;
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
        row.innerHTML = `<span>${sub}</span><small>${arr.length}</small>`;
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

/* =========================================================
   ✅ NUEVO: DESTACADOS (2 artículos por categoría)
   - Requiere: <div id="featured-by-category"></div> en el HTML
   - Callbacks:
     onClickProduct(id)  -> para saltar al producto
     onViewCategory(cat) -> para filtrar toda la categoría
     onAddToCart(id)     -> opcional para que "Agregar" funcione
   ========================================================= */
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

  // agrupar por categoría (tomamos los primeros N que aparezcan en el array)
  const map = new Map();
  for (const p of list) {
    const cat = String(p?.categoria ?? p?.category ?? "Otros").trim() || "Otros";
    if (!map.has(cat)) map.set(cat, []);
    const arr = map.get(cat);
    if (arr.length < perCategory) arr.push(p);
  }

  // ordenar categorías alfabéticamente
  const groups = Array.from(map.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], "es")
  );

  const frag = document.createDocumentFragment();

  groups.forEach(([cat, items]) => {
    const section = document.createElement("section");
    section.className = "featured-cat";

    // Header
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

    // Grid (2 cards)
    const grid = document.createElement("div");
    grid.className = "featured-grid";

    items.forEach((p) => {
      const card = document.createElement("div");
      card.className = "product-card featured-card";

      // Badge (misma lógica base)
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

      // Imagen (lazy)
      const img = document.createElement("img");
      img.className = "product-image";
      const imgSrc = p.imagen || p.img || "";
      setupFastImage(img, imgSrc, getProductName(p) || "Producto", {
        priority: "low",
        loading: "lazy",
      });
      card.appendChild(img);

      // Content
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

      // Click card -> ir al producto
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
// =======================
// ✅ NAVEGAR A PRODUCTO (desde destacados)
// =======================
function isInteractiveTarget(el) {
  return !!el.closest("button, a, input, select, textarea, label");
}

function normalizeStr(s) {
  return String(s ?? "").trim();
}

/**
 * Navega al Catálogo, aplica filtros (cat/subcat) y enfoca el producto.
 * Requiere que tus cards tengan data-id (lo agregamos abajo).
 */
export function goToProductInCatalogue(product, opts = {}) {
  const cat = normalizeStr(product?.categoria ?? product?.category);
  const sub = normalizeStr(product?.subcategoria ?? product?.subcategory);
  const id = String(product?.id ?? product?.ID ?? "").trim();

  const catSel = document.getElementById("category-filter");
  const subSel = document.getElementById("subcategory-filter");
  const searchInput = document.getElementById("search-input");

  // 1) Ir al catálogo
  document.querySelector("#catalogue")?.scrollIntoView({ behavior: "smooth", block: "start" });

  // 2) Limpiar búsqueda (opcional, pero recomendado)
  if (searchInput) searchInput.value = "";

  // 3) Setear categoría
  if (catSel && cat) {
    catSel.value = cat;
    catSel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // 4) Setear subcategoría (esperamos un poco por si el change llena opciones)
  window.setTimeout(() => {
    if (subSel && sub) {
      subSel.style.display = "";
      subSel.value = sub;
      subSel.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // 5) Scroll al producto exacto (cuando ya está renderizado)
    window.setTimeout(() => {
      const card = document.querySelector(`.product-card[data-id="${CSS.escape(id)}"]`);
      if (!card) return;

      // Quitar focus anterior
      document.querySelectorAll(".product-card.focused").forEach((n) => n.classList.remove("focused"));

      card.classList.add("focused");
      card.scrollIntoView({ behavior: "smooth", block: "center" });

      // Sacar highlight luego de un rato
      window.setTimeout(() => card.classList.remove("focused"), 2200);
    }, 120);
  }, 120);
}
