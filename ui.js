/*
 * ui.js — MODIFICADO y COMPLETO
 */

function toNumberPrice(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;

  let s = String(v).trim();
  s = s.replace(/\$/g, "").trim();
  s = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function roundUYU(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v); // ✅ 0.5+ sube, 0.4 baja
}

function getProductName(p) {
  return String(p?.nombre ?? p?.name ?? "").trim();
}

function getBasePrice(p) {
  return toNumberPrice(p?.precio ?? p?.price);
}

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

function getQtyPromoText(product) {
  const tramos = product?.dpc?.tramos;
  if (!Array.isArray(tramos) || tramos.length === 0) return "";

  for (const t of tramos) {
    const min = Number(t?.min);
    const precio = toNumberPrice(t?.precio);

    if (Number.isFinite(min) && min > 0 && precio > 0) {
      return `Llevando ${min} rebaja a $${roundUYU(precio)} c/u`; // ✅ redondeo visible
    }
  }
  return "";
}

function money(n) {
  const v = roundUYU(n);
  return `$ ${v}`;
}

/**
 * Total del carrito:
 * - Usa unit real (puede tener decimales)
 * - Subtotal redondeado por ítem
 * - Total = suma de subtotales redondeados
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
    if (unit > 0) {
      const subtotalExact = unit * qty;
      const subtotalRounded = roundUYU(subtotalExact);
      total += subtotalRounded;
    }
  }

  return total;
}

export function updateCartTotal(totalEl, products, cart) {
  if (!totalEl) return;
  totalEl.textContent = money(computeCartTotal(products, cart));
}

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

    const img = document.createElement("img");
    img.className = "product-image";

    const BASE =
      typeof import.meta !== "undefined" &&
      import.meta.env &&
      import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : "./";

    const imgSrc = product.imagen || product.img || "";
    img.src = imgSrc || `${BASE}placeholder.png`;
    img.alt = getProductName(product) || "Producto";
    card.appendChild(img);

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

    const promoText = getQtyPromoText(product);
    if (promoText) {
      const note = document.createElement("div");
      note.className = "price-note";
      note.textContent = promoText;
      content.appendChild(note);
    }

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
      const price = bp > 0 ? money(bp) : "Consultar";
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

    const unit = getUnitPriceByQty(product, q);
    const rowTotalExact = unit > 0 ? unit * q : 0;
    const rowTotalRounded = roundUYU(rowTotalExact);

    const calc = document.createElement("div");
    calc.className = "cart-item-calc";

    if (unit > 0) {
      calc.textContent = `${q} x ${money(unit)} = ${money(rowTotalRounded)}`; // ✅ coherente
    } else {
      calc.textContent = "Consultar";
    }

    item.appendChild(calc);

    const controls = document.createElement("div");
    controls.className = "cart-item-controls";

    const minus = document.createElement("button");
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
    plus.textContent = "+";
    plus.onclick = () => updateHandler && updateHandler(id, q + 1);

    const remove = document.createElement("button");
    remove.textContent = "✖";
    remove.onclick = () => removeHandler && removeHandler(id);

    controls.append(minus, input, plus, remove);
    item.appendChild(controls);

    container.appendChild(item);
  });

  // ✅ devolvemos el total redondeado coherente
  return computeCartTotal(products, cart);
}

export function updateCartCount(countEl, count) {
  if (!countEl) return;
  countEl.textContent = count;
}

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
