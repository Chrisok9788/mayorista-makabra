import { addOrderToHistory } from "./src/order-history.js";

/*
 * whatsapp.js — MODIFICADO y COMPLETO (PROMO MIX + total correcto)
 * Cambios:
 * ✅ Redondeo UYU en TODO: unitario, subtotales y total final (Math.round)
 * ✅ getUnitPriceByQty soporta max vacío/0/null como "sin tope" (Infinity)
 * ✅ Mantiene compatibilidad nombre/name y precio/price
 * ✅ Mantiene compatibilidad carrito por id o por nombre
 * ✅ PROMO MIX por promo_group (igual que ui.js)
 * ✅ Guarda el pedido en Supabase antes de abrir WhatsApp
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

async function persistOrder(orderPayload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch("/api/order-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload),
      signal: controller.signal,
      cache: "no-store",
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
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

function getPromoGroup(p) {
  const g = String(p?.promo_group ?? p?.promoGroup ?? p?.grupo_promo ?? "").trim();
  return g || "";
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

export async function sendOrder(cart, products, deliveryProfile = null) {
  const entries = Object.entries(cart || {});
  if (!entries.length) {
    alert("Tu carrito está vacío.");
    return;
  }

  const customerId = getOrCreateCustomerId();
  const orderId = makeOrderId();
  const deliveryCode = String(deliveryProfile?.code || "").trim();
  const isDeliveryEnabled = Boolean(deliveryProfile && /^\d{7}$/.test(deliveryCode));
  const customerLabel = isDeliveryEnabled ? `C-${deliveryCode}` : customerId;

  let address = isDeliveryEnabled
    ? String(deliveryProfile?.address || "").trim()
    : localStorage.getItem("customerAddress") || "";
  const isNewCustomer = !isDeliveryEnabled && !address;

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

  const groupQtyMap = new Map();
  for (const it of resolvedItems) {
    const g = getPromoGroup(it.product);
    if (!g) continue;
    groupQtyMap.set(g, (groupQtyMap.get(g) || 0) + it.qty);
  }

  function getEffectiveQtyForPricing(product, itemQty) {
    const g = getPromoGroup(product);
    if (!g) return itemQty;
    const qg = groupQtyMap.get(g);
    return Number(qg) > 0 ? Number(qg) : itemQty;
  }

  const lines = [];

  if (isDeliveryEnabled) {
    lines.push("REPARTO");
    lines.push(`Código: ${deliveryCode}`);
    lines.push(`Nombre: ${String(deliveryProfile.name || "").trim()}`);
    lines.push(`Dirección: ${String(deliveryProfile.address || "").trim()}`);
    lines.push(`Tel: ${String(deliveryProfile.phone || "").trim()}`);
    lines.push("");
  }

  lines.push(`Pedido: ${orderId}`);
  lines.push(`Cliente: ${customerLabel}`);
  lines.push("");

  let totalRoundedSum = 0;
  let hasConsult = false;
  const historyItems = [];

  for (const it of resolvedItems) {
    const qty = Number(it.qty) || 0;
    if (qty < 1) continue;

    const product = it.product;
    const nombre = getProductName(product);
    const effQty = getEffectiveQtyForPricing(product, qty);
    const unitExact = getUnitPriceByQty(product, effQty);

    if (unitExact <= 0) {
      hasConsult = true;
      lines.push(`${qty} x ${nombre} — Consultar precio`);
      continue;
    }

    const unitRounded = roundUYU(unitExact);
    const subtotalRounded = roundUYU(unitExact * qty);

    totalRoundedSum += subtotalRounded;
    historyItems.push({
      productId: String(product?.id ?? it.key ?? "").trim(),
      name: nombre,
      qty,
      unitPriceRounded: unitRounded,
      subtotalRounded,
    });

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

  if (address.trim() && !isDeliveryEnabled) {
    lines.push("");
    lines.push(`Dirección: ${address.trim()}`);
  }

  lines.push("");
  lines.push("A la brevedad nos comunicaremos vía WhatsApp para coordinar.");

  const message = lines.join("\n");

  const orderPayload = {
    orderId,
    createdAt: new Date().toISOString(),
    customerKey: customerLabel,
    customerLabel,
    deliveryCode: isDeliveryEnabled ? deliveryCode : null,
    customerName: isDeliveryEnabled ? String(deliveryProfile?.name || "").trim() : null,
    customerAddress: address.trim() || null,
    customerPhone: isDeliveryEnabled ? String(deliveryProfile?.phone || "").trim() : null,
    items: historyItems,
    totalRounded: totalRoundedSum,
    hasConsultables: hasConsult,
    messagePreview: message.slice(0, 300),
    messageText: message,
  };

  let savedToDatabase = false;
  try {
    await persistOrder(orderPayload);
    savedToDatabase = true;
  } catch (error) {
    console.error("No se pudo guardar el pedido en Supabase:", error);
    alert(
      "El pedido se abrirá en WhatsApp, pero no pudo guardarse en la base de datos. " +
      "Conservá el mensaje de WhatsApp como respaldo."
    );
  }

  addOrderToHistory(orderPayload);

  const whatsappURL =
    "https://wa.me/59896405927?text=" + encodeURIComponent(message);

  window.location.href = whatsappURL;

  return {
    sentToWhatsApp: true,
    savedToDatabase,
    isDeliveryEnabled,
  };
}
