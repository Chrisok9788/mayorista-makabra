/*
 * whatsapp.js
 * Genera y envía el pedido por WhatsApp con:
 * - ID interno de pedido
 * - ID de cliente persistente
 * - Dirección para clientes nuevos
 * - Detalle de productos
 * - Total del pedido
 * - ✅ Precio por cantidad (dpc.tramos) si existe
 * - ✅ Compatibilidad con catálogos viejos/nuevos (nombre/name, precio/price)
 */

function formatUYU(n) {
  const num = Number(n) || 0;
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

/**
 * Devuelve el precio unitario aplicando promo por cantidad si existe.
 * dpc esperado:
 *  dpc: { tramos: [ {min, max, precio}, ... ] }
 */
function getUnitPriceByQty(product, qty) {
  const base = toNumberPrice(product?.precio ?? product?.price);

  const tramos = product?.dpc?.tramos;
  if (!Array.isArray(tramos) || tramos.length === 0) return base;

  for (const t of tramos) {
    const min = Number(t?.min);
    const max = Number(t?.max);
    const precio = toNumberPrice(t?.precio);

    if (!Number.isFinite(min) || !Number.isFinite(max)) continue;

    if (qty >= min && qty <= max) {
      return precio > 0 ? precio : base;
    }
  }

  return base;
}

/**
 * Envía el pedido armado por WhatsApp
 *
 * @param {Object} cart Objeto carrito { productId: qty }
 * @param {Array} products Lista completa de productos
 */
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

  // Índices para compatibilidad con carritos viejos
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

  let total = 0;
  let hasConsult = false;
  let foundAny = false;

  entries.forEach(([productId, qtyRaw]) => {
    const qty = Number(qtyRaw) || 0;
    if (qty < 1) return;

    const key = String(productId ?? "").trim();

    // 1) Buscar por id
    // 2) Si no existe, buscar por nombre (carritos viejos)
    const product = byId.get(key) || byNombre.get(key);
    if (!product) return;

    foundAny = true;

    const nombre = getProductName(product);

    // ✅ Precio por cantidad si existe (si no, precio base)
    const unit = getUnitPriceByQty(product, qty);

    if (unit <= 0) {
      hasConsult = true;
      lines.push(`${qty} x ${nombre} — Consultar precio`);
      return;
    }

    const subtotal = unit * qty;
    total += subtotal;

    // Si el precio unitario por cantidad difiere del base, lo dejamos implícito
    // (el cliente ve "c/u" ya con el valor aplicado)
    lines.push(
      `${qty} x ${nombre} — ${formatUYU(unit)} c/u — Subtotal: ${formatUYU(subtotal)}`
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

  // ✅ número en formato internacional (sin +, sin espacios)
  const whatsappURL =
    "https://wa.me/59896405927?text=" + encodeURIComponent(message);

  // ✅ iPhone/Safari: evita bloqueo de popups
  window.location.href = whatsappURL;
}
