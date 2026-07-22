const cartContainer = document.getElementById("cart-container");
const PLACEHOLDER = "/placeholder.png";

let catalogPromise = null;
let productById = new Map();
let enhanceScheduled = false;

function text(value) {
  return String(value ?? "").trim();
}

function productId(product) {
  return text(product?.id ?? product?.scanntechId ?? product?.codigoInterno);
}

function productImage(product) {
  return text(
    product?.imagen ??
      product?.img ??
      product?.imagen_url ??
      product?.image_url ??
      product?.imageUrl,
  );
}

function resolveImageUrl(value) {
  const source = text(value);
  if (!source) return PLACEHOLDER;
  if (/^(https?:)?\/\//i.test(source) || /^(data|blob):/i.test(source)) return source;

  const clean = source.replace(/^\.?\//, "").replace(/^\/+/, "");
  const safePath = clean
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `/${safePath}`;
}

async function loadCatalog() {
  if (productById.size) return productById;
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    try {
      const response = await fetch("/api/catalog", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "default",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      const products = Array.isArray(payload) ? payload : payload?.products;
      if (!Array.isArray(products)) return productById;

      productById = new Map(
        products
          .map((product) => [productId(product), product])
          .filter(([id]) => Boolean(id)),
      );
    } catch (error) {
      console.warn("[cart-thumbnails] No se pudieron cargar miniaturas:", error);
    }

    return productById;
  })();

  return catalogPromise;
}

function getItemId(item) {
  return text(item.querySelector("[data-id]")?.getAttribute("data-id"));
}

function addThumbnail(item, product) {
  if (item.querySelector(".cart-item-thumb-wrap")) return;

  const wrap = document.createElement("div");
  wrap.className = "cart-item-thumb-wrap";
  wrap.setAttribute("aria-hidden", "true");

  const image = document.createElement("img");
  image.className = "cart-item-thumb";
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.src = resolveImageUrl(productImage(product));
  image.addEventListener(
    "error",
    () => {
      if (image.src.endsWith(PLACEHOLDER)) return;
      image.src = PLACEHOLDER;
    },
    { once: true },
  );

  wrap.appendChild(image);
  item.prepend(wrap);
}

async function enhanceCart() {
  enhanceScheduled = false;
  if (!cartContainer) return;

  const catalog = await loadCatalog();
  cartContainer.querySelectorAll(".cart-item").forEach((item) => {
    const id = getItemId(item);
    addThumbnail(item, catalog.get(id));
  });
}

function scheduleEnhancement() {
  if (enhanceScheduled) return;
  enhanceScheduled = true;
  requestAnimationFrame(() => {
    enhanceCart();
  });
}

if (cartContainer) {
  new MutationObserver(scheduleEnhancement).observe(cartContainer, {
    childList: true,
    subtree: true,
  });
}

document.getElementById("cart-open-btn")?.addEventListener("click", scheduleEnhancement);
window.addEventListener("pageshow", scheduleEnhancement);
window.addEventListener("resize", scheduleEnhancement);
scheduleEnhancement();