/*
 * ui.js
 * Módulo de interfaz de usuario para el sitio del mayorista.
 * Renderiza productos, carrito, contador, filtros y carrusel de ofertas.
 * Compatible con GitHub Pages.
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

  // Elegimos el tramo que matchee (qty dentro del rango)
  for (const t of tramos) {
    const min = Number(t?.min);
    const max = Number(t?.max);
    const precio = toNumberPrice(t?.precio);

    if (!Number.isFinite(min) || min <= 0) continue;

    // max puede venir vacío, null, 0 o 999999 (lo tratamos como "sin tope")
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
 *
 * IMPORTANTE: NO usa "max", por eso nunca mostrará 999999.
 * Toma el primer tramo válido (min y precio).
 */
function getQtyPromoText(product) {
  const tramos = product?.dpc?.tramos;
  if (!Array.isArray(tramos) || tramos.length === 0) return "";

  for (const t of tramos) {
    const min = Number(t?.min);
    const precio = toNumberPrice(t?.precio);

    if (Number.isFinite(min) && min > 0 && precio > 0) {
      return `Llevando ${min} rebaja a $${precio} c/u`;
    }
  }

  return "";
}

/**
 * Calcula total del carrito aplicando promos por cantidad si existen.
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
    if (unit > 0) total += unit * qty;
  }
  return total;
}

/**
 * Actualiza el total en pantalla.
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

    // IMAGEN
    const img = document.createElement("img");
    img.className = "product-image";

    const BASE =
      typeof import.meta !== "undefined" &&
      import.meta.env &&
      import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : "./";

    // soporta ambos nombres de campo
    const imgSrc = product.imagen || product.img || "";
    img.src = imgSrc || `${BASE}placeholder.png`;
    img.alt = getProductName(product) || "Producto";
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
      price.textContent = `$ ${basePrice}`;
    } else {
      price.textContent = "Consultar";
    }
    content.appendChild(price);

    // PROMO POR CANTIDAD (debajo del precio)
    const promoText = getQtyPromoText(product);
    if (promoText) {
      const note = document.createElement("div");
      note.className = "price-note";
      note.textContent = promoText; // ✅ nunca muestra max (999999)
      content.appendChild(note);
    }

    // BOTÓN
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Agregar al carrito";

    btn.addEventListener("click", () => {
      addHandler && addHandler(product.id);

      // feedback visual
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

  const cardsHtml = offers
    .map((p) => {
      const name = getProductName(p) || "Producto";
      const img = p.imagen || p.img || "";
      const bp = getBasePrice(p);
      const price = bp > 0 ? `$ ${bp}` : "Consultar";
      const promo = getQtyPromoText(p);

      return `
        <div class="offer-card" data-id="${p.id ?? ""}">
          ${
            img
              ? `<img class="offer-img" src="${img}" alt="${name}">`
              : `<div class="offer-img"></div>`
          }
          <div class="offer-body">
            <p class="offer-title">${name}</p>
            <div class="offer-price">${price}</div>
            ${promo ? `<div class="offer-note">${promo}</div>` : ``}
          </div>
        </div>
      `;
    })
    .join("");

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
    const product = byId.get(id);
    if (!product) return;

    const item = document.createElement("div");
    item.className = "cart-item";

    const left = document.createElement("div");

    const name = document.createElement("div");
    name.className = "cart-item-name";
    name.textContent = getProductName(product) || "Producto";
    left.appendChild(name);

    // Nota promo por cantidad en carrito
    const promoText = getQtyPromoText(product);
    if (promoText) {
      const note = document.createElement("div");
      note.className = "cart-item-note";
      note.textContent = promoText; // ✅ nunca muestra max (999999)
      left.appendChild(note);
    }

    item.appendChild(left);

    const controls = document.createElement("div");
    controls.className = "cart-item-controls";

    const minus = document.createElement("button");
    minus.textContent = "−";
    minus.onclick = () => updateHandler && updateHandler(id, Number(qty) - 1);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.value = qty;
    input.onchange = (e) => {
      const v = parseInt(e.target.value, 10);
      const safe = isNaN(v) ? 1 : Math.max(1, v);
      updateHandler && updateHandler(id, safe);
    };

    const plus = document.createElement("button");
    plus.textContent = "+";
    plus.onclick = () => updateHandler && updateHandler(id, Number(qty) + 1);

    const remove = document.createElement("button");
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
    new Set((products || []).map((p) => (p.categoria || p.category || "").trim()).filter(Boolean))
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
