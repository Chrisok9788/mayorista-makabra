/*
 * whatsapp.js — MODIFICADO y COMPLETO (PROMO MIX + total correcto)
 * Cambios:
 * ✅ Redondeo UYU en TODO: unitario, subtotales y total final (Math.round)
 * ✅ getUnitPriceByQty soporta max vacío/0/null como "sin tope" (Infinity)
 * ✅ Mantiene compatibilidad nombre/name y precio/price
 * ✅ Mantiene compatibilidad carrito por id o por nombre
 * ✅ NUEVO: PROMO MIX por promo_group (igual que ui.js)
 *    - Suma cantidades del carrito por promo_group
 *    - Calcula precio unitario usando qty efectiva del grupo cuando corresponde
 */

function roundUYU(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
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

/** ✅ Promo group (mix): soporta varias columnas por compatibilidad */
function getPromoGroup(p) {
  const g = String(p?.promo_group ?? p?.promoGroup ?? p?.grupo_promo ?? "").trim();
  return g || "";
}

/**
 * Devuelve el precio unitario aplicando promo por cantidad si existe.
 * dpc esperado:
 *  dpc: { tramos: [ {min, max, precio}, ... ] }
 * - max puede venir null/0/vacío → se trata como "sin tope"
 *
 * NOTA: qty puede ser qty del ítem o qty del grupo (mix).
 */
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

/**
 * Envía el pedido armado por WhatsApp
 *
 * @param {Object} cart Objeto carrito { productId: qty } (o nombre -> qty en carritos viejos)
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

  // ==========================
  // ✅ Resolver items reales del carrito (id o nombre)
  // ==========================
  const resolvedItems = [];
  for (const [productId, qtyRaw] of entries) {
    const qty = Number(qtyRaw) || 0;
    if (qty < 1) continue;

    const key = String(productId ?? "").trim();
    const product = byId.get(key) || byNombre.get(key);
    if (!product) continue;

    resolvedItems.push({ key, qty, product });
  }

  if (!resolvedItems.length) {
    alert("No se pudieron leer los productos del carrito (IDs no coinciden).");
    return;
  }

  // ==========================
  // ✅ PROMO MIX: sumar cantidades por promo_group
  // ==========================
  const groupQtyMap = new Map();
  for (const it of resolvedItems) {
    const g = getPromoGroup(it.product);
    if (!g) continue;
    groupQtyMap.set(g, (groupQtyMap.get(g) || 0) + it.qty);
  }

  /** Qty efectiva: si hay promo_group, usa qty del grupo, si no usa qty del ítem */
  function getEffectiveQtyForPricing(product, itemQty) {
    const g = getPromoGroup(product);
    if (!g) return itemQty;
    const qg = groupQtyMap.get(g);
    return Number(qg) > 0 ? Number(qg) : itemQty;
  }

  // ==========================
  // Mensaje
  // ==========================
  const lines = [];
  lines.push(`Pedido: ${orderId}`);
  lines.push(`Cliente: ${customerId}`);
  lines.push("");

  let totalRoundedSum = 0; // ✅ sumamos subtotales ya redondeados
  let hasConsult = false;

  for (const it of resolvedItems) {
    const qty = Number(it.qty) || 0;
    if (qty < 1) continue;

    const product = it.product;
    const nombre = getProductName(product);

    // ✅ CLAVE: precio según qty efectiva (grupo si hay mix)
    const effQty = getEffectiveQtyForPricing(product, qty);
    const unitExact = getUnitPriceByQty(product, effQty);

    if (unitExact <= 0) {
      hasConsult = true;
      lines.push(`${qty} x ${nombre} — Consultar precio`);
      continue;
    }

    // ✅ Redondeo coherente: unit mostrado redondeado, subtotal redondeado y total suma de subtotales
    const unitRounded = roundUYU(unitExact);
    const subtotalRounded = roundUYU(unitExact * qty);

    totalRoundedSum += subtotalRounded;

    lines.push(
      `${qty} x ${nombre} — ${formatUYU(unitRounded)} c/u — Subtotal: ${formatUYU(
        subtotalRounded
      )}`
    );
  }

  lines.push("");

  if (hasConsult) {
    lines.push("Nota: Algunos productos quedan como 'Consultar precio'.");
  }

  lines.push(`Total (sin consultables): ${formatUYU(totalRoundedSum)}`);

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
