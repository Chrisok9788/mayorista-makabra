function safeText(value) {
  return String(value ?? "").trim();
}

function toNumberPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = safeText(value);
  if (!raw) return 0;

  let normalized = raw.replace(/\$/g, "").replace(/\s+/g, "");
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = normalized.replace(/,/g, ".");
  }

  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function toMoney(value) {
  return `$ ${Math.round(toNumberPrice(value))}`;
}

function findProduct(products, key) {
  const normalized = safeText(key);
  return products.find((product) => safeText(product.id) === normalized);
}

function getUnitPriceByQty(product, qty) {
  const base = toNumberPrice(product?.precio ?? product?.price);
  const tramos = product?.dpc?.tramos;
  if (!Array.isArray(tramos)) return base;

  for (const tramo of tramos) {
    const min = Number(tramo?.min);
    const max = Number(tramo?.max);
    const promo = toNumberPrice(tramo?.precio);
    if (!Number.isFinite(min) || min <= 0 || qty < min) continue;
    if (Number.isFinite(max) && max > 0 && qty > max) continue;
    return promo > 0 ? promo : base;
  }

  return base;
}

export function computeCartTotal(products, cart) {
  const exactTotal = Object.entries(cart || {}).reduce((total, [id, qtyRaw]) => {
    const product = findProduct(products, id);
    if (!product) return total;
    const qty = Number(qtyRaw) || 0;
    if (qty <= 0) return total;
    return total + getUnitPriceByQty(product, qty) * qty;
  }, 0);

  return Math.round(exactTotal);
}

export function updateCartTotal(totalEl, products, cart) {
  if (!totalEl) return;
  totalEl.textContent = toMoney(computeCartTotal(products, cart));
}

function createProductCard(product, addHandler) {
  const article = document.createElement("article");
  article.className = "product-card";
  article.dataset.id = safeText(product.id);

  const image = document.createElement("img");
  image.className = "product-image";
  image.alt = safeText(product.nombre) || "Producto";
  image.loading = "lazy";
  image.decoding = "async";
  image.src = safeText(product.imagen) || "/public/placeholder.png";
  image.addEventListener("error", () => {
    image.src = "/public/placeholder.png";
  });

  const content = document.createElement("div");
  content.className = "product-content";

  const title = document.createElement("h3");
  title.textContent = safeText(product.nombre) || "Producto";

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.textContent = [safeText(product.marca), safeText(product.categoria)].filter(Boolean).join(" · ");

  const price = document.createElement("p");
  price.className = "price";
  price.textContent = toNumberPrice(product.precio) > 0 ? toMoney(product.precio) : "Consultar";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.setAttribute("aria-label", `Agregar ${safeText(product.nombre)} al carrito`);
  button.textContent = "Agregar al carrito";
  button.addEventListener("click", () => addHandler?.(safeText(product.id)));

  content.append(title, meta, price, button);
  article.append(image, content);
  return article;
}

export function renderProducts(list, container, addHandler) {
  if (!container) return;
  container.textContent = "";

  const fragment = document.createDocumentFragment();
  for (const product of list || []) {
    fragment.appendChild(createProductCard(product, addHandler));
  }

  container.appendChild(fragment);
}

export function renderOffersCarousel(products, _frameEl, trackEl, onClick) {
  if (!trackEl) return;
  trackEl.textContent = "";
  const fragment = document.createDocumentFragment();

  (products || [])
    .filter((product) => product.oferta_carrusel)
    .slice(0, 12)
    .forEach((product) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "offer-chip";
      button.textContent = safeText(product.nombre);
      button.addEventListener("click", () => onClick?.(product));
      fragment.appendChild(button);
    });

  trackEl.appendChild(fragment);
}

export function renderCart(products, cart, container, updateHandler, removeHandler) {
  if (!container) return;
  container.textContent = "";

  const fragment = document.createDocumentFragment();

  for (const [id, qtyRaw] of Object.entries(cart || {})) {
    const qty = Number(qtyRaw) || 0;
    if (qty <= 0) continue;

    const product = findProduct(products, id);
    if (!product) continue;

    const row = document.createElement("div");
    row.className = "cart-item";

    const label = document.createElement("span");
    const unit = getUnitPriceByQty(product, qty);
    label.textContent = `${safeText(product.nombre)} · ${toMoney(unit * qty)}`;

    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.value = String(qty);
    qtyInput.addEventListener("change", () => {
      const nextQty = Math.max(1, Number(qtyInput.value) || 1);
      updateHandler?.(safeText(product.id), nextQty);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn";
    removeBtn.textContent = "Quitar";
    removeBtn.addEventListener("click", () => removeHandler?.(safeText(product.id)));

    row.append(label, qtyInput, removeBtn);
    fragment.appendChild(row);
  }

  container.appendChild(fragment);
}

export function updateCartCount(countEl, count) {
  if (countEl) countEl.textContent = String(count || 0);
}

export function populateCategories(products, select) {
  if (!select) return;
  const categories = [...new Set((products || []).map((item) => safeText(item.categoria)).filter(Boolean))].sort();

  select.textContent = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Todas las categorías";
  select.appendChild(all);

  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  }
}

export function populateSubcategories(products, category, select) {
  if (!select) return;
  const subs = [...new Set((products || [])
    .filter((item) => !category || safeText(item.categoria) === safeText(category))
    .map((item) => safeText(item.subcategoria))
    .filter(Boolean))].sort();

  select.textContent = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Todas las subcategorías";
  select.appendChild(all);

  for (const sub of subs) {
    const option = document.createElement("option");
    option.value = sub;
    option.textContent = sub;
    select.appendChild(option);
  }
  select.style.display = subs.length ? "" : "none";
}

export function filterProducts(products, category, searchTerm, subcategory = "") {
  const search = safeText(searchTerm).toLowerCase();
  return (products || []).filter((product) => {
    const categoryMatch = !category || safeText(product.categoria) === safeText(category);
    const subcategoryMatch = !subcategory || safeText(product.subcategoria) === safeText(subcategory);
    const searchMatch = !search || safeText(product.searchKey).includes(search);
    return categoryMatch && subcategoryMatch && searchMatch;
  });
}

export function renderCategoryAccordion() {}
export function renderFeaturedByCategory() {}
