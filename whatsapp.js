/*
 * whatsapp.js — MODIFICADO y COMPLETO
 */

function roundUYU(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function formatUYU(n) {
  const num = roundUYU(n);
  return "$ " + num.toLocaleString("es-UY");
}

function makeOrderId() {
  return "MK-" + Date.now().toString(36).toUpperCase();
}

function getOrCreateCustomerId() {
  let id = localStorage.getItem("customerId");
  if (!id) {
    id = "C-" + Math.floor(Math.random() * 900000 + 100000);
    localStorage.setItem("customerId", id);
  }
  return id;
}

function toNumberPrice(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;

  let s = String(v).trim();
  s = s.replace(/\$/g, "").trim();
  s = s.replace(/\./g, "").replace(/,/g, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function getProductName(p) {
  return String(p?.nombre ?? p?.name ?? "").trim();
}

function getUnitPriceByQty(product, qty) {
  const base = toNumberPrice(product?.precio ?? product?.price);

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

export function sendOrder(cart, products) {
  const entries = Object.entries(cart || {});
  if (!entries.length) {
    alert("Tu carrito está vacío.");
    return;
  }

  const customerId = getOrCreateCustomerId();
  const orderId = makeOrderId();

  let address = localStorage.getItem("customerAddress") || "";
  const isNewCustomer = !address;

  if (isNewCustomer) {
    address =
      prompt("Cliente nuevo:\nIngresá tu dirección para coordinar la entrega.") || "";

    if (address.trim()) {
      localStorage.setItem("customerAddress", address.trim());
    }
  }

  const byId = new Map();
  const byNombre = new Map();

  for (const p of products || []) {
    const id = String(p?.id ?? "").trim();
    const nombre = getProductName(p);
    if (id) byId.set(id, p);
    if (nombre) byNombre.set(nombre, p);
  }

  const lines = [];
  lines.push(`Pedido: ${orderId}`);
  lines.push(`Cliente: ${customerId}`);
  lines.push("");

  let total = 0; // ✅ total redondeado por línea
  let hasConsult = false;
  let foundAny = false;

  entries.forEach(([productId, qtyRaw]) => {
    const qty = Number(qtyRaw) || 0;
    if (qty < 1) return;

    const key = String(productId ?? "").trim();
    const product = byId.get(key) || byNombre.get(key);
    if (!product) return;

    foundAny = true;

    const nombre = getProductName(product);
    const unit = getUnitPriceByQty(product, qty);

    if (unit <= 0) {
      hasConsult = true;
      lines.push(`${qty} x ${nombre} — Consultar precio`);
      return;
    }

    const subtotalExact = unit * qty;
    const subtotalRounded = roundUYU(subtotalExact);
    total += subtotalRounded;

    // Mostramos unit redondeado, pero subtotal calculado desde exact y redondeado al final
    lines.push(
      `${qty} x ${nombre} — ${formatUYU(unit)} c/u — Subtotal: ${formatUYU(subtotalRounded)}`
    );
  });

  if (!foundAny) {
    alert("No se pudieron leer los productos del carrito (IDs no coinciden).");
    return;
  }

  lines.push("");

  if (hasConsult) {
    lines.push("Nota: Algunos productos quedan como 'Consultar precio'.");
  }

  lines.push(`Total (sin consultables): ${formatUYU(total)}`);

  if (address.trim()) {
    lines.push("");
    lines.push(`Dirección: ${address.trim()}`);
  }

  lines.push("");
  lines.push("A la brevedad nos comunicaremos vía WhatsApp para coordinar.");

  const message = lines.join("\n");
  const whatsappURL = "https://wa.me/59896405927?text=" + encodeURIComponent(message);

  window.location.href = whatsappURL;
}
