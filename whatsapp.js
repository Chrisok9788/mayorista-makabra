/*
 * whatsapp.js
 * Genera y envía el pedido por WhatsApp con:
 * - ID interno de pedido
 * - ID de cliente persistente
 * - Dirección para clientes nuevos
 * - Detalle de productos
 * - Total del pedido
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

/**
 * Envía el pedido armado por WhatsApp
 *
 * @param {Object} cart Objeto carrito { productId: qty }
 * @param {Array} products Lista completa de productos
 */
export function sendOrder(cart, products) {
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

  const lines = [];
  lines.push(`Pedido: ${orderId}`);
  lines.push(`Cliente: ${customerId}`);
  lines.push("");

  let total = 0;
  let hasConsult = false;

  Object.entries(cart || {}).forEach(([productId, qty]) => {
    const product = (products || []).find((p) => p.id === productId);
    if (!product) return;

    const price = Number(product.precio) || 0;

    if (price <= 0) {
      hasConsult = true;
      lines.push(`${qty} x ${product.nombre} — Consultar precio`);
      return;
    }

    const subtotal = price * qty;
    total += subtotal;

    lines.push(
      `${qty} x ${product.nombre} — ${formatUYU(price)} c/u — Subtotal: ${formatUYU(subtotal)}`
    );
  });

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
  const whatsappURL =
    "https://wa.me/59896405927?text=" + encodeURIComponent(message);

  // ✅ iPhone/Safari: mejor que window.open
  window.location.href = whatsappURL;
}
