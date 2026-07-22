import { addOrderToHistory } from "./src/order-history.js";

/*
 * whatsapp.js — PROMO MIX + guardado operativo de pedidos
 *
 * - Redondeo UYU en unitarios, subtotales y total.
 * - Mantiene promociones por cantidad y promo_group.
 * - Guarda el pedido completo antes de abrir WhatsApp.
 * - Si un cliente registrado ya tiene un pedido de menos de 24 horas,
 *   el servidor suma este envío al pedido activo.
 */

function roundUYU(n) {
  const value = Number(n);
  return Number.isFinite(value) ? Math.round(value) : 0;
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

function toNumberPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;

  let text = String(value).trim();
  text = text.replace(/\$/g, "").trim();
  text = text.replace(/\./g, "").replace(/,/g, ".");
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function getProductName(product) {
  return String(product?.nombre ?? product?.name ?? "").trim();
}

function getProductSector(product) {
  return String(
    product?.sector ?? product?.categoria ?? product?.category ?? "Sin sector",
  ).trim();
}

function getPromoGroup(product) {
  const group = String(
    product?.promo_group ?? product?.promoGroup ?? product?.grupo_promo ?? "",
  ).trim();
  return group || "";
}

function getUnitPriceByQty(product, qty) {
  const base = toNumberPrice(product?.precio ?? product?.price);
  const tiers = product?.dpc?.tramos;
  if (!Array.isArray(tiers) || tiers.length === 0) return base;

  for (const tier of tiers) {
    const min = Number(tier?.min);
    const max = Number(tier?.max);
    const price = toNumberPrice(tier?.precio);

    if (!Number.isFinite(min) || min <= 0) continue;

    const maximum = Number.isFinite(max) && max > 0 ? max : Number.POSITIVE_INFINITY;
    if (qty >= min && qty <= maximum) {
      return price > 0 ? price : base;
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
  const incomingOrderId = makeOrderId();
  const deliveryCode = String(deliveryProfile?.code || "").trim();
  const isDeliveryEnabled = Boolean(
    deliveryProfile && /^\d{5,7}$/.test(deliveryCode),
  );
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
  const byName = new Map();

  for (const product of products || []) {
    const id = String(product?.id ?? "").trim();
    const name = getProductName(product);
    if (id) byId.set(id, product);
    if (name) byName.set(name, product);
  }

  const resolvedItems = [];
  for (const [productId, rawQty] of entries) {
    const qty = Number(rawQty) || 0;
    if (qty < 1) continue;

    const key = String(productId ?? "").trim();
    const product = byId.get(key) || byName.get(key);
    if (!product) continue;

    resolvedItems.push({ key, qty, product });
  }

  if (!resolvedItems.length) {
    alert("No se pudieron leer los productos del carrito (IDs no coinciden).");
    return;
  }

  const groupQtyMap = new Map();
  for (const item of resolvedItems) {
    const group = getPromoGroup(item.product);
    if (!group) continue;
    groupQtyMap.set(group, (groupQtyMap.get(group) || 0) + item.qty);
  }

  function effectiveQuantityForPricing(product, itemQty) {
    const group = getPromoGroup(product);
    if (!group) return itemQty;
    const groupQty = groupQtyMap.get(group);
    return Number(groupQty) > 0 ? Number(groupQty) : itemQty;
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

  lines.push(`Pedido: ${incomingOrderId}`);
  lines.push(`Cliente: ${customerLabel}`);
  lines.push("");

  let totalRoundedSum = 0;
  let hasConsultables = false;
  const orderItems = [];

  for (const item of resolvedItems) {
    const qty = Number(item.qty) || 0;
    if (qty < 1) continue;

    const product = item.product;
    const name = getProductName(product);
    const sector = getProductSector(product);
    const effectiveQty = effectiveQuantityForPricing(product, qty);
    const exactUnitPrice = getUnitPriceByQty(product, effectiveQty);
    const productId = String(product?.id ?? item.key ?? "").trim();

    if (exactUnitPrice <= 0) {
      hasConsultables = true;
      orderItems.push({
        productId,
        name,
        qty,
        unitPriceRounded: 0,
        subtotalRounded: 0,
        consultable: true,
        sector,
      });
      lines.push(`${qty} x ${name} — Consultar precio`);
      continue;
    }

    const unitRounded = roundUYU(exactUnitPrice);
    const subtotalRounded = roundUYU(exactUnitPrice * qty);

    totalRoundedSum += subtotalRounded;
    orderItems.push({
      productId,
      name,
      qty,
      unitPriceRounded: unitRounded,
      subtotalRounded,
      consultable: false,
      sector,
    });

    lines.push(
      `${qty} x ${name} — ${formatUYU(unitRounded)} c/u — Subtotal: ${formatUYU(
        subtotalRounded,
      )}`,
    );
  }

  lines.push("");

  if (hasConsultables) {
    lines.push("Nota: Algunos productos quedan como 'Consultar precio'.");
  }

  lines.push(`Total (sin consultables): ${formatUYU(totalRoundedSum)}`);

  if (address.trim() && !isDeliveryEnabled) {
    lines.push("");
    lines.push(`Dirección: ${address.trim()}`);
  }

  lines.push("");
  lines.push("A la brevedad nos comunicaremos vía WhatsApp para coordinar.");

  let message = lines.join("\n");
  const orderPayload = {
    orderId: incomingOrderId,
    createdAt: new Date().toISOString(),
    customerKey: customerLabel,
    customerLabel,
    deliveryCode: isDeliveryEnabled ? deliveryCode : null,
    customerName: isDeliveryEnabled
      ? String(deliveryProfile?.name || "").trim()
      : null,
    customerAddress: address.trim() || null,
    customerPhone: isDeliveryEnabled
      ? String(deliveryProfile?.phone || "").trim()
      : null,
    items: orderItems,
    totalRounded: totalRoundedSum,
    hasConsultables,
    messagePreview: message.slice(0, 300),
    messageText: message,
  };

  let savedToDatabase = false;
  let mergedIntoExisting = false;
  let canonicalOrderId = incomingOrderId;

  try {
    const saveResult = await persistOrder(orderPayload);
    savedToDatabase = true;
    mergedIntoExisting = Boolean(saveResult?.merged);
    canonicalOrderId = String(saveResult?.order_id || incomingOrderId);

    if (mergedIntoExisting && canonicalOrderId !== incomingOrderId) {
      message = message.replace(
        `Pedido: ${incomingOrderId}`,
        `Pedido activo: ${canonicalOrderId}\nActualización: ${incomingOrderId}`,
      );
      message = `PEDIDO AGREGADO AL ANTERIOR\n\n${message}`;
      orderPayload.messagePreview = message.slice(0, 300);
      orderPayload.messageText = message;
      orderPayload.canonicalOrderId = canonicalOrderId;
      orderPayload.merged = true;
    }
  } catch (error) {
    console.error("No se pudo guardar el pedido en Supabase:", error);
    alert(
      "El pedido se abrirá en WhatsApp, pero no pudo guardarse en la base de datos. " +
        "Conservá el mensaje de WhatsApp como respaldo.",
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
    mergedIntoExisting,
    canonicalOrderId,
  };
}
