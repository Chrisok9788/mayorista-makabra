/*
 * Módulo de interfaz de usuario para el sitio del mayorista.
 * Contiene funciones para renderizar productos, el carrito,
 * actualizar contadores y filtrar resultados.
 * Totalmente compatible con GitHub Pages.
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

/** Formatea moneda UYU simple (sin decimales) */
function formatUYU(n) {
  const num = Math.round(Number(n) || 0);
  return `$ ${num.toLocaleString("es-UY")}`;
}

/**
 * Helpers: soporta ambos formatos de producto (viejo y nuevo)
 * - nombre / name
 * - precio / price
 * - oferta / offer
 * - imagen / img
 */
function getProductName(p) {
  return String(p?.nombre ?? p?.name ?? "").trim();
}

function getProductImage(p) {
  return p?.imagen ?? p?.img ?? "";
}

function getProductOffer(p) {
  return Boolean(p?.oferta ?? p?.offer);
}

function getProductPrice(p) {
  return toNumberPrice(p?.precio ?? p?.price);
}

/**
 * Devuelve texto de promoción por cantidad (DPC) si existe.
 * Formato esperado:
 *   dpc: { tramos: [ {min, max?, precio}, ... ] }
 *
 * Ej:
 *   "Promo por cantidad: llevando 5+ u. $ 65 c/u"
 */
function getDpcText(p) {
  const tramos = p?.dpc?.tramos;
  if (!Array.isArray(tramos) || tramos.length === 0) return "";

  // Armamos un resumen corto (máx. 2 tramos para no ensuciar la tarjeta)
  const parts = [];
  for (const t of tramos) {
    const min = Number(t?.min);
    const maxRaw = t?.max;
    const max = Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : Infinity;
    const precio = toNumberPrice(t?.precio);

    if (!Number.isFinite(min) || min < 1 || precio <= 0) continue;

    if (max === Infinity) {
      parts.push(`llevando ${min}+ u. ${formatUYU(precio)} c/u`);
    } else {
      parts.push(`${min}-${max} u. ${formatUYU(precio)} c/u`);
    }

    if (parts.length >= 2) break;
  }

  if (!parts.length) return "";
  return `Promo por cantidad: ${parts.join(" | ")}`;
}

/** Precio unitario aplicando promo por cantidad si corresponde */
function getUnitPriceByQty(product, qty) {
  const base = getProductPrice(product);
  const tramos = product?.dpc?.tramos;
  if (!Array.isArray(tramos) || tramos.length === 0) return base;

  const q = Number(qty) || 0;
  if (q < 1) return base;

  for (const t of tramos) {
    const min = Number(t?.min);
    const maxRaw = t?.max;
    const max = Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : Infinity;
    const promo = toNumberPrice(t?.precio);

    if (!Number.isFinite(min) || min < 1) continue;
    if (q >= min && q <= max) return promo > 0 ? promo : base;
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
 * NUEVO: Calcula total del carrito usando products (campo: precio)
 * @param {Array} products
 * @param {Object} cart  (id -> qty)
 * @returns {number}
 */
export function computeCartTotal(products, cart) {
  if (!Array.isArray(products) || !products.length) return 0;
  if (!cart || typeof cart !== "object") return 0;

  // Map por id para buscar rápido
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
 * NUEVO: Actualiza el elemento del total en pantalla.
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

  if (!list || !list.length) {
    container.innerHTML = "<p>No se encontraron productos.</p>";
    return;
  }

  list.forEach((product) => {
    const name = getProductName(product) || "Producto";
    const imgSrc = getProductImage(product);
    const hasStockInfo = typeof product.stock !== "undefined";
    const inStock = !hasStockInfo || product.stock > 0;
    const isOffer = getProductOffer(product);
    const basePrice = getProductPrice(product);
    const promoText = getDpcText(product);

    const card = document.createElement("div");
    card.className = "product-card";

    // BADGE
    let badgeLabel = "";
    let badgeClass = "";

    if (hasStockInfo && !inStock) {
      badgeLabel = "SIN STOCK";
      badgeClass = "sin-stock";
    } else if (isOffer === true) {
      badgeLabel = "OFERTA";
      badgeClass = "oferta";
    } else if (basePrice == null || basePrice <= 0) {
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

    const BASE =
      typeof import.meta !== "undefined" &&
      import.meta.env &&
      import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : "./";

    img.src = imgSrc || `${BASE}placeholder.png`;
    img.alt = name;
    card.appendChild(img);

    // CONTENIDO
    const content = document.createElement("div");
    content.className = "product-content";

    const title = document.createElement("h3");
    title.textContent = name;
    content.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "meta";

    if (product.marca) meta.appendChild(document.createTextNode(product.marca));

    if (product.presentacion) {
      if (meta.childNodes.length)
        meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(document.createTextNode(product.presentacion));
    }

    if (!meta.childNodes.length && product.categoria) {
      meta.appendChild(document.createTextNode(product.categoria));
    }

    if (meta.childNodes.length) content.appendChild(meta);

    // PRECIO
    const price = document.createElement("p");
    price.className = "price";

    if (hasStockInfo && !inStock) {
      price.textContent = "Sin stock";
    } else if (basePrice != null && basePrice > 0) {
      price.textContent = formatUYU(basePrice);
    } else {
      price.textContent = "Consultar";
    }

    content.appendChild(price);

    // ✅ AGREGAR ESTO (debajo del precio): promo por cantidad (si existe)
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

      // Feedback visual tipo "tap" (iPhone friendly)
      btn.classList.add("btn-tap");
      setTimeout(() => {
        btn.classList.remove("btn-tap");
      }, 100);
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
    return getProductOffer(p) === true && inStock;
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
      const img = getProductImage(p) || "";
      const basePrice = getProductPrice(p);
      const price =
        basePrice != null && basePrice > 0 ? formatUYU(basePrice) : "Consultar";
      const promo = getDpcText(p);

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
            ${promo ? `<div class="offer-note">${promo}</div>` : ""}
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
 * IMPORTANTE: devuelve el total calculado (por si querés usar retorno).
 */
export function renderCart(
  products,
  cart,
  container,
  updateHandler,
  removeHandler
) {
  if (!container) return 0;
  container.innerHTML = "";

  const entries = Object.entries(cart || {});
  if (!entries.length) {
    container.innerHTML = "<p>Tu carrito está vacío.</p>";
    return 0;
  }

  // Map por id para render rápido y seguro
  const byId = new Map(
    (products || []).map((p) => [String(p.id ?? "").trim(), p])
  );

  entries.forEach(([productId, qty]) => {
    const id = String(productId ?? "").trim();
    const product = byId.get(id);
    if (!product) return;

    const item = document.createElement("div");
    item.className = "cart-item";

    const name = document.createElement("div");
    name.className = "cart-item-name";
    name.textContent = getProductName(product) || "Producto";
    item.appendChild(name);

    // Precio aplicado + nota de promo por cantidad (si existe)
    const qtyNum = Number(qty) || 0;
    const baseUnit = getProductPrice(product);
    const unit = getUnitPriceByQty(product, qtyNum);
    if (unit > 0) {
      const line = document.createElement("div");
      line.className = "cart-item-meta";
      const subtotal = unit * qtyNum;
      const unitTxt = formatUYU(unit) + " c/u";
      const subTxt = "Subtotal: " + formatUYU(subtotal);
      line.textContent =
        baseUnit > 0 && unit !== baseUnit
          ? `${unitTxt} (promo) · ${subTxt}`
          : `${unitTxt} · ${subTxt}`;
      item.appendChild(line);
    }

    const promoText = getDpcText(product);
    if (promoText) {
      const promo = document.createElement("div");
      promo.className = "cart-item-note";
      promo.textContent = promoText;
      item.appendChild(promo);
    }

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

  // Devuelve total para que lo uses si querés
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
        .map((p) => (p.categoria || "").trim())
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
 * NUEVO: Carga subcategorías en el select, según categoría elegida.
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
        .filter((p) => (p.categoria || "").trim() === category)
        .map((p) => (p.subcategoria || "").trim())
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
    result = result.filter((p) => (p.categoria || "").trim() === category);
  }

  if (searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    result = result.filter((p) => {
      const text = [
        p.nombre,
        p.marca || "",
        p.categoria || "",
        p.subcategoria || "",
        (p.tags || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(term);
    });
  }

  return result;
}

/**
 * Panel tipo acordeón
 */
export function renderCategoryAccordion(products, onSelect) {
  const accordion = document.getElementById("categoryAccordion");
  if (!accordion) return;
  accordion.innerHTML = "";

  const allProducts = Array.isArray(products) ? products : [];

  const catMap = new Map();
  for (const p of allProducts) {
    const cat = (p.categoria || "Otros").trim();
    const sub = (p.subcategoria || "Otros").trim();
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
      const count = Array.from(subMap.values()).reduce(
        (a, arr) => a + arr.length,
        0
      );

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
    const totalCount = Array.from(subMap.values()).reduce(
      (a, arr) => a + arr.length,
      0
    );
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
