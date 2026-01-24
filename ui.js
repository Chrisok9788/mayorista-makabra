/*
 * ui.js — versión corregida y defensiva (formato viejo + formato API)
 * Soporta:
 * - nombre / name
 * - categoria / category
 * - subcategoria / subcategory
 * - precio / price
 * - oferta / offer
 * - imagen / img
 * - promos por cantidad: dpc.tramos [{min,max,precio}]
 *
 * Compatible con GitHub Pages (sin dependencias).
 */

/** Convierte precio a número (por si viene como string) */
function toNumberPrice(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;

  let s = String(v).trim();
  s = s.replace(/\$/g, "").trim();
  s = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Normaliza string */
function s(v) {
  return String(v ?? "").trim();
}

/** Compat: nombre */
function getProductName(p) {
  return s(p?.nombre ?? p?.name);
}

/** Compat: categoria */
function getProductCategory(p) {
  return s(p?.categoria ?? p?.category);
}

/** Compat: subcategoria */
function getProductSubcategory(p) {
  return s(p?.subcategoria ?? p?.subcategory);
}

/** Compat: oferta */
function isOffer(p) {
  return Boolean(p?.oferta ?? p?.offer);
}

/** Compat: stock (si existiera) */
function getStock(p) {
  const v = p?.stock ?? p?.stockOnline ?? p?.stock_online;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined; // undefined = sin info
}

/** Compat: imagen */
function getProductImage(p) {
  return s(p?.imagen ?? p?.img);
}

/** Precio base (sin promo por cantidad) */
function getBasePrice(p) {
  return toNumberPrice(p?.precio ?? p?.price);
}

/**
 * Precio unitario por cantidad (promo por cantidad si existe)
 * dpc: { tramos: [ {min, max, precio}, ... ] }
 */
function getUnitPriceByQty(product, qty) {
  const base = getBasePrice(product);
  const tramos = product?.dpc?.tramos;

  if (!Array.isArray(tramos) || tramos.length === 0) return base;

  for (const t of tramos) {
    const min = Number(t?.min);
    const max = Number(t?.max);
    const precio = toNumberPrice(t?.precio);

    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
    if (qty >= min && qty <= max) return precio > 0 ? precio : base;
  }
  return base;
}

/**
 * Vibración corta (defensiva).
 * No hace nada si el dispositivo/navegador no lo soporta.
 */
function vibrate60ms() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(60);
    }
  } catch {
    // silencioso
  }
}

/**
 * Calcula total del carrito usando products (precio/price) + promos por cantidad (dpc).
 * @param {Array} products
 * @param {Object} cart  (id -> qty)
 * @returns {number}
 */
export function computeCartTotal(products, cart) {
  if (!Array.isArray(products) || !products.length) return 0;
  if (!cart || typeof cart !== "object") return 0;

  // Map por id para buscar rápido
  const byId = new Map(
    products.map((p) => [s(p?.id), p]).filter(([id]) => Boolean(id))
  );

  // Map por nombre (compat carrito viejo)
  const byName = new Map();
  for (const p of products) {
    const name = getProductName(p);
    if (name) byName.set(name, p);
  }

  let total = 0;

  for (const [rawKey, rawQty] of Object.entries(cart)) {
    const key = s(rawKey);
    const qty = Number(rawQty) || 0;
    if (!key || qty < 1) continue;

    const p = byId.get(key) || byName.get(key);
    if (!p) continue;

    const unit = getUnitPriceByQty(p, qty);
    if (unit > 0) total += unit * qty;
  }

  return total;
}

/**
 * Actualiza el elemento del total en pantalla.
 * @param {HTMLElement} totalEl
 * @param {Array} products
 * @param {Object} cart
 */
export function updateCartTotal(totalEl, products, cart) {
  if (!totalEl) return;
  const total = computeCartTotal(products, cart);
  totalEl.textContent = `$ ${total}`;
}

/**
 * Renderiza la lista de productos en un contenedor.
 */
export function renderProducts(list, container, addHandler) {
  if (!container) return;
  container.innerHTML = "";

  if (!Array.isArray(list) || list.length === 0) {
    container.innerHTML = "<p>No se encontraron productos.</p>";
    return;
  }

  list.forEach((product) => {
    const card = document.createElement("div");
    card.className = "product-card";

    const name = getProductName(product) || "Producto";
    const category = getProductCategory(product);
    const subcategory = getProductSubcategory(product);
    const imgPath = getProductImage(product);

    const stock = getStock(product);
    const hasStockInfo = typeof stock !== "undefined";
    const inStock = !hasStockInfo || stock > 0;

    const basePrice = getBasePrice(product);

    // BADGE
    let badgeLabel = "";
    let badgeClass = "";

    if (hasStockInfo && stock <= 0) {
      badgeLabel = "SIN STOCK";
      badgeClass = "sin-stock";
    } else if (isOffer(product)) {
      badgeLabel = "OFERTA";
      badgeClass = "oferta";
    } else if (!basePrice || basePrice <= 0) {
      badgeLabel = "CONSULTAR";
      badgeClass = "consultar";
    }

    if (badgeLabel) {
      const badge = document.createElement("span");
      badge.className = `badge ${badgeClass}`;
      badge.textContent = badgeLabel;
      card.appendChild(badge);
    }

    // IMAGEN
    const img = document.createElement("img");
    img.className = "product-image";

    // GitHub Pages: BASE "./"
    const BASE =
      typeof import.meta !== "undefined" &&
      import.meta.env &&
      import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : "./";

    img.src = imgPath || `${BASE}placeholder.png`;
    img.alt = name;
    // fallback si la imagen no existe
    img.onerror = () => {
      img.onerror = null;
      img.src = `${BASE}placeholder.png`;
    };
    card.appendChild(img);

    // CONTENIDO
    const content = document.createElement("div");
    content.className = "product-content";

    const title = document.createElement("h3");
    title.textContent = name;
    content.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";

    // marca/presentacion (viejo)
    if (product?.marca) meta.appendChild(document.createTextNode(s(product.marca)));

    if (product?.presentacion) {
      if (meta.childNodes.length) meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(document.createTextNode(s(product.presentacion)));
    }

    // si no hay meta, ponemos categoría/subcategoría
    if (!meta.childNodes.length) {
      const catText = [category, subcategory].filter(Boolean).join(" · ");
      if (catText) meta.appendChild(document.createTextNode(catText));
      else if (category) meta.appendChild(document.createTextNode(category));
    }

    if (meta.childNodes.length) content.appendChild(meta);

    // PRECIO (base)
    const priceEl = document.createElement("p");
    priceEl.className = "price";

    if (!inStock) {
      priceEl.textContent = "Sin stock";
    } else if (basePrice > 0) {
      priceEl.textContent = `$ ${basePrice}`;
    } else {
      priceEl.textContent = "Consultar";
    }

    content.appendChild(priceEl);

    // BOTÓN
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Agregar al carrito";
    btn.disabled = !inStock;

    btn.addEventListener("click", () => {
      if (!inStock) return;

      addHandler && addHandler(product.id);

      // Feedback háptico
      vibrate60ms();

      // Feedback visual tipo "tap" (iPhone friendly)
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
 */
export function renderOffersCarousel(products, frameEl, trackEl, onClick) {
  if (!frameEl || !trackEl) return;

  trackEl.innerHTML = "";
  const prevEmpty = frameEl.querySelector(".offers-empty");
  if (prevEmpty) prevEmpty.remove();

  const offers = (products || []).filter((p) => {
    const stock = getStock(p);
    const hasStockInfo = typeof stock !== "undefined";
    const inStock = !hasStockInfo || stock > 0;
    return isOffer(p) && inStock;
  });

  if (offers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "offers-empty";
    empty.textContent = "No hay ofertas cargadas.";
    frameEl.appendChild(empty);
    return;
  }

  const cardsHtml = offers
    .map((p) => {
      const id = s(p?.id);
      const name = getProductName(p) || "Producto";
      const img = getProductImage(p);
      const priceNum = getBasePrice(p);
      const price = priceNum > 0 ? `$ ${priceNum}` : "Consultar";

      return `
        <div class="offer-card" data-id="${id}">
          ${
            img
              ? `<img class="offer-img" src="${img}" alt="${name}" onerror="this.onerror=null;this.style.display='none';">`
              : `<div class="offer-img"></div>`
          }
          <div class="offer-body">
            <p class="offer-title">${name}</p>
            <div class="offer-price">${price}</div>
          </div>
        </div>
      `;
    })
    .join("");

  // loop si hay varias
  trackEl.innerHTML = offers.length >= 2 ? cardsHtml + cardsHtml : cardsHtml;

  if (typeof onClick === "function") {
    trackEl.querySelectorAll(".offer-card").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        if (id) onClick(id);
      });
    });
  }
}

/**
 * Renderiza el carrito.
 * IMPORTANTE: devuelve el total calculado (por si querés usar retorno).
 */
export function renderCart(products, cart, container, updateHandler, removeHandler) {
  if (!container) return 0;
  container.innerHTML = "";

  const entries = Object.entries(cart || {});
  if (!entries.length) {
    container.innerHTML = "<p>Tu carrito está vacío.</p>";
    return 0;
  }

  const byId = new Map(
    (products || []).map((p) => [s(p?.id), p]).filter(([id]) => Boolean(id))
  );

  // compat carrito viejo por nombre
  const byName = new Map();
  for (const p of products || []) {
    const name = getProductName(p);
    if (name) byName.set(name, p);
  }

  entries.forEach(([productKey, qtyRaw]) => {
    const key = s(productKey);
    const qty = Number(qtyRaw) || 0;
    if (!key || qty < 1) return;

    const product = byId.get(key) || byName.get(key);
    if (!product) return;

    const item = document.createElement("div");
    item.className = "cart-item";

    const nameEl = document.createElement("div");
    nameEl.className = "cart-item-name";
    nameEl.textContent = getProductName(product) || "Producto";
    item.appendChild(nameEl);

    const controls = document.createElement("div");
    controls.className = "cart-item-controls";

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.type = "button";
    minus.onclick = () => updateHandler && updateHandler(product.id, qty - 1);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.value = String(qty);
    input.onchange = (e) => {
      const v = parseInt(e.target.value, 10);
      const safe = isNaN(v) ? 1 : Math.max(1, v);
      updateHandler && updateHandler(product.id, safe);
    };

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.type = "button";
    plus.onclick = () => updateHandler && updateHandler(product.id, qty + 1);

    const remove = document.createElement("button");
    remove.textContent = "✖";
    remove.type = "button";
    remove.onclick = () => removeHandler && removeHandler(product.id);

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
        .map((p) => getProductCategory(p))
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
        .filter((p) => getProductCategory(p) === s(category))
        .map((p) => getProductSubcategory(p))
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
 * Nota: tags puede venir null / string / array.
 */
export function filterProducts(products, category, searchTerm) {
  let result = Array.isArray(products) ? products : [];

  if (category) {
    const cat = s(category);
    result = result.filter((p) => getProductCategory(p) === cat);
  }

  if (searchTerm) {
    const term = s(searchTerm).toLowerCase();

    result = result.filter((p) => {
      const tags = p?.tags;
      const tagsStr = Array.isArray(tags)
        ? tags.join(" ")
        : typeof tags === "string"
        ? tags
        : "";

      const text = [
        getProductName(p),
        s(p?.marca),
        getProductCategory(p),
        getProductSubcategory(p),
        tagsStr,
      ]
        .join(" ")
        .toLowerCase();

      return text.includes(term);
    });
  }

  return result;
}

/**
 * Panel tipo acordeón (categorías -> subcategorías)
 */
export function renderCategoryAccordion(products, onSelect) {
  const accordion = document.getElementById("categoryAccordion");
  if (!accordion) return;
  accordion.innerHTML = "";

  const allProducts = Array.isArray(products) ? products : [];

  const catMap = new Map();
  for (const p of allProducts) {
    const cat = getProductCategory(p) || "Otros";
    const sub = getProductSubcategory(p) || "Otros";

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
    allBtn.onclick = () =>
      typeof onSelect === "function" && onSelect(allProducts);
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

      const t = s(term).toLowerCase();
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
