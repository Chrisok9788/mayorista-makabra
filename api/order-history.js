export const config = { runtime: "nodejs" };

const DELIVERY_CODE_REGEX = /^\d{5,7}$/;
const MAX_ITEMS = 200;
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const SCHEMA_CACHE_MS = 60 * 1000;

let operationalSchemaCache = {
  checkedAt: 0,
  available: false,
};

function toStr(value) {
  return String(value ?? "").trim();
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function sanitizeCode(value) {
  return toStr(value).replace(/\D/g, "");
}

function clampInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value) || 0);
  return Math.min(max, Math.max(min, parsed));
}

function supabaseConfig() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !secret) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel");
  }
  return { baseUrl, secret };
}

async function supabaseRequest(path, options = {}) {
  const { baseUrl, secret } = supabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: options.prefer || "return=minimal",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text.slice(0, 1200)}`);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sanitizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_ITEMS) {
    return [];
  }

  const grouped = new Map();

  for (const raw of rawItems) {
    const productId = toStr(raw?.productId).slice(0, 160);
    const name = toStr(raw?.name).slice(0, 300);
    const qty = clampInteger(raw?.qty, 1, 100000);
    if (!productId || !name || qty < 1) continue;

    const unitPrice = clampInteger(raw?.unitPriceRounded, 0, 100000000);
    const receivedSubtotal = clampInteger(raw?.subtotalRounded, 0, 1000000000);
    const subtotal = receivedSubtotal || unitPrice * qty;
    const consultable = Boolean(raw?.consultable) || unitPrice <= 0;
    const sector = toStr(raw?.sector || raw?.category).slice(0, 120) || null;

    const previous = grouped.get(productId);
    if (previous) {
      previous.qty += qty;
      previous.subtotalRounded += subtotal;
      previous.consultable = previous.consultable || consultable;
      if (!previous.sector && sector) previous.sector = sector;
      previous.unitPriceRounded = previous.qty
        ? Math.round(previous.subtotalRounded / previous.qty)
        : 0;
      continue;
    }

    grouped.set(productId, {
      productId,
      name,
      qty,
      unitPriceRounded: unitPrice,
      subtotalRounded: subtotal,
      consultable,
      sector,
    });
  }

  return [...grouped.values()];
}

function calculateOrderTotal(items, receivedTotal) {
  const calculated = items.reduce(
    (sum, item) => sum + clampInteger(item?.subtotalRounded, 0, 1000000000),
    0,
  );

  return calculated || clampInteger(receivedTotal, 0, 1000000000);
}

function parseOrderPayload(body) {
  const payload = body && typeof body === "object" ? body : null;
  if (!payload) return null;

  const orderId = toStr(payload.orderId).slice(0, 80);
  const customerKey = toStr(payload.customerKey).slice(0, 100);
  const customerLabel = toStr(payload.customerLabel || customerKey).slice(0, 100);

  if (!orderId || !customerKey) return null;
  if (!/^MK-[A-Z0-9-]+$/i.test(orderId)) return null;

  const keyCode = customerKey.startsWith("C-") ? sanitizeCode(customerKey.slice(2)) : "";
  const suppliedCode = sanitizeCode(payload.deliveryCode);
  const deliveryCode = DELIVERY_CODE_REGEX.test(suppliedCode)
    ? suppliedCode
    : DELIVERY_CODE_REGEX.test(keyCode)
      ? keyCode
      : "";
  const items = sanitizeItems(payload.items);

  return {
    orderId,
    customerKey,
    customerLabel,
    deliveryCode: deliveryCode || null,
    customerName: toStr(payload.customerName).slice(0, 300) || null,
    customerPhone: toStr(payload.customerPhone).slice(0, 80) || null,
    items,
    total: calculateOrderTotal(items, payload.totalRounded),
    hasConsultables:
      Boolean(payload.hasConsultables) || items.some((item) => item.consultable),
    createdAt: toStr(payload.createdAt) || new Date().toISOString(),
  };
}

async function loadDeliveryClient(code) {
  if (!code) return null;

  const rows = await supabaseRequest(
    `clientes?select=id,codigo,nombre,telefono,activo&codigo=eq.${encodeURIComponent(code)}&limit=1`,
    { method: "GET", prefer: "return=representation" },
  );

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function operationalSchemaAvailable() {
  const now = Date.now();
  if (now - operationalSchemaCache.checkedAt < SCHEMA_CACHE_MS) {
    return operationalSchemaCache.available;
  }

  try {
    await Promise.all([
      supabaseRequest("pedido_items?select=id&limit=1", {
        method: "GET",
        prefer: "return=representation",
      }),
      supabaseRequest("pedido_ingresos?select=order_id&limit=1", {
        method: "GET",
        prefer: "return=representation",
      }),
      supabaseRequest(
        "pedidos?select=estado_armado,estado_facturacion,actualizaciones,ultimo_ingreso_en&limit=1",
        { method: "GET", prefer: "return=representation" },
      ),
    ]);
    operationalSchemaCache = { checkedAt: now, available: true };
  } catch (error) {
    console.warn("[order-history] Esquema operativo todavía no disponible:", String(error));
    operationalSchemaCache = { checkedAt: now, available: false };
  }

  return operationalSchemaCache.available;
}

async function loadProcessedIncoming(orderId) {
  const rows = await supabaseRequest(
    `pedido_ingresos?select=pedido_order_id&order_id=eq.${encodeURIComponent(orderId)}&limit=1`,
    { method: "GET", prefer: "return=representation" },
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadOrderByOrderId(orderId) {
  const rows = await supabaseRequest(
    `pedidos?select=id,order_id,cliente_id,cliente_codigo,cliente_clave,cliente_nombre,cliente_telefono,estado,estado_armado,estado_facturacion,total_uyu,tiene_consultables,actualizaciones,creado_en,actualizado_en,ultimo_ingreso_en&order_id=eq.${encodeURIComponent(orderId)}&limit=1`,
    { method: "GET", prefer: "return=representation" },
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadActiveRegisteredOrder(deliveryCode) {
  if (!deliveryCode) return null;

  const cutoff = new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
  const rows = await supabaseRequest(
    `pedidos?select=id,order_id,cliente_id,cliente_codigo,cliente_clave,cliente_nombre,cliente_telefono,estado,estado_armado,estado_facturacion,total_uyu,tiene_consultables,actualizaciones,creado_en,actualizado_en,ultimo_ingreso_en&cliente_codigo=eq.${encodeURIComponent(deliveryCode)}&creado_en=gte.${encodeURIComponent(cutoff)}&order=creado_en.asc&limit=1`,
    { method: "GET", prefer: "return=representation" },
  );

  return Array.isArray(rows) ? rows[0] || null : null;
}

function itemRecord(orderId, item, existing = null) {
  const existingQty = clampInteger(existing?.cantidad, 0, 1000000);
  const existingSubtotal = clampInteger(existing?.subtotal_uyu, 0, 1000000000);
  const quantity = existingQty + item.qty;
  const subtotal = existingSubtotal + item.subtotalRounded;

  return {
    pedido_order_id: orderId,
    producto_id: item.productId,
    producto_nombre: item.name,
    cantidad: quantity,
    precio_unitario_uyu: quantity > 0 ? Math.round(subtotal / quantity) : 0,
    subtotal_uyu: subtotal,
    consultable: Boolean(existing?.consultable) || item.consultable,
    armado: false,
    sector: existing?.sector || item.sector,
    actualizado_en: new Date().toISOString(),
  };
}

async function saveExactItems(orderId, items) {
  if (!items.length) return [];

  const now = new Date().toISOString();
  const records = items.map((item) => ({
    pedido_order_id: orderId,
    producto_id: item.productId,
    producto_nombre: item.name,
    cantidad: item.qty,
    precio_unitario_uyu: item.unitPriceRounded,
    subtotal_uyu: item.subtotalRounded,
    consultable: item.consultable,
    armado: false,
    sector: item.sector,
    actualizado_en: now,
  }));

  return supabaseRequest(
    "pedido_items?on_conflict=pedido_order_id,producto_id",
    {
      method: "POST",
      prefer: "return=representation,resolution=merge-duplicates",
      body: JSON.stringify(records),
    },
  );
}

async function mergeItems(orderId, items) {
  if (!items.length) return [];

  const existingRows = await supabaseRequest(
    `pedido_items?select=producto_id,producto_nombre,cantidad,precio_unitario_uyu,subtotal_uyu,consultable,armado,sector&pedido_order_id=eq.${encodeURIComponent(orderId)}`,
    { method: "GET", prefer: "return=representation" },
  );
  const existingMap = new Map(
    (Array.isArray(existingRows) ? existingRows : []).map((item) => [
      toStr(item.producto_id),
      item,
    ]),
  );
  const records = items.map((item) =>
    itemRecord(orderId, item, existingMap.get(item.productId) || null),
  );

  return supabaseRequest(
    "pedido_items?on_conflict=pedido_order_id,producto_id",
    {
      method: "POST",
      prefer: "return=representation,resolution=merge-duplicates",
      body: JSON.stringify(records),
    },
  );
}

async function recordIncoming(incomingOrderId, canonicalOrderId) {
  return supabaseRequest("pedido_ingresos?on_conflict=order_id", {
    method: "POST",
    prefer: "return=representation,resolution=ignore-duplicates",
    body: JSON.stringify({
      order_id: incomingOrderId,
      pedido_order_id: canonicalOrderId,
      creado_en: new Date().toISOString(),
    }),
  });
}

async function saveNewOperationalOrder(order, client) {
  const now = new Date().toISOString();
  const record = {
    order_id: order.orderId,
    cliente_id: client?.id ?? null,
    cliente_codigo: order.deliveryCode,
    cliente_clave: order.customerKey,
    cliente_nombre: client?.nombre || order.customerName || order.customerLabel,
    cliente_telefono: client?.telefono || order.customerPhone || null,
    estado: "pendiente",
    estado_armado: "pendiente",
    estado_facturacion: "pendiente",
    total_uyu: order.total,
    tiene_consultables: order.hasConsultables,
    actualizaciones: 1,
    origen: "web_whatsapp",
    creado_en: now,
    actualizado_en: now,
    ultimo_ingreso_en: now,
  };

  const rows = await supabaseRequest("pedidos?on_conflict=order_id", {
    method: "POST",
    prefer: "return=representation,resolution=merge-duplicates",
    body: JSON.stringify(record),
  });
  const saved = Array.isArray(rows) ? rows[0] || null : null;
  if (!saved) throw new Error("Supabase no devolvió el pedido guardado");

  await saveExactItems(order.orderId, order.items);
  await recordIncoming(order.orderId, order.orderId);

  return {
    ...saved,
    merged: false,
    duplicate: false,
    incomingOrderId: order.orderId,
  };
}

async function mergeIntoOperationalOrder(active, order, client) {
  await mergeItems(active.order_id, order.items);

  const previousArmStatus = toStr(active.estado_armado) || "pendiente";
  const nextArmStatus = previousArmStatus === "pendiente" ? "pendiente" : "armando";
  const now = new Date().toISOString();
  const updateRecord = {
    cliente_id: client?.id ?? active.cliente_id ?? null,
    cliente_nombre: client?.nombre || active.cliente_nombre || order.customerName,
    cliente_telefono: client?.telefono || active.cliente_telefono || order.customerPhone,
    estado: nextArmStatus,
    estado_armado: nextArmStatus,
    estado_facturacion: "pendiente",
    total_uyu: clampInteger(active.total_uyu, 0, 1000000000) + order.total,
    tiene_consultables: Boolean(active.tiene_consultables) || order.hasConsultables,
    actualizaciones: clampInteger(active.actualizaciones, 1, 1000000) + 1,
    actualizado_en: now,
    ultimo_ingreso_en: now,
  };

  const rows = await supabaseRequest(
    `pedidos?order_id=eq.${encodeURIComponent(active.order_id)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify(updateRecord),
    },
  );
  const saved = Array.isArray(rows) ? rows[0] || null : null;
  if (!saved) throw new Error("No se pudo actualizar el pedido activo");

  await recordIncoming(order.orderId, active.order_id);

  return {
    ...saved,
    merged: true,
    duplicate: false,
    incomingOrderId: order.orderId,
  };
}

async function saveOperationalOrder(order, client) {
  const processed = await loadProcessedIncoming(order.orderId);
  if (processed?.pedido_order_id) {
    const existing = await loadOrderByOrderId(processed.pedido_order_id);
    if (existing) {
      return {
        ...existing,
        merged: existing.order_id !== order.orderId,
        duplicate: true,
        incomingOrderId: order.orderId,
      };
    }
  }

  if (order.deliveryCode) {
    const active = await loadActiveRegisteredOrder(order.deliveryCode);
    if (active) return mergeIntoOperationalOrder(active, order, client);
  }

  return saveNewOperationalOrder(order, client);
}

async function saveLegacyOrder(order, client) {
  const now = new Date().toISOString();
  const record = {
    order_id: order.orderId,
    cliente_id: client?.id ?? null,
    cliente_codigo: order.deliveryCode,
    cliente_clave: order.customerKey,
    cliente_nombre: client?.nombre || order.customerName || order.customerLabel,
    cliente_telefono: client?.telefono || order.customerPhone || null,
    estado: "pendiente",
    total_uyu: order.total,
    tiene_consultables: order.hasConsultables,
    origen: "web_whatsapp",
    creado_en: now,
    actualizado_en: now,
  };

  const rows = await supabaseRequest("pedidos?on_conflict=order_id", {
    method: "POST",
    prefer: "return=representation,resolution=merge-duplicates",
    body: JSON.stringify(record),
  });

  const saved = Array.isArray(rows) ? rows[0] || null : null;
  if (!saved) throw new Error("Supabase no devolvió el pedido guardado");

  return {
    ...saved,
    merged: false,
    duplicate: false,
    incomingOrderId: order.orderId,
  };
}

async function saveOrder(order) {
  const client = await loadDeliveryClient(order.deliveryCode);

  if (order.deliveryCode && (!client || client.activo === false)) {
    const error = new Error("CLIENTE_REPARTO_NO_VALIDO");
    error.statusCode = 400;
    throw error;
  }

  const operational = await operationalSchemaAvailable();
  const saved = operational
    ? await saveOperationalOrder(order, client)
    : await saveLegacyOrder(order, client);

  return { saved, operational };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  let order;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    order = parseOrderPayload(body);
  } catch {
    return sendJson(res, 400, { ok: false, error: "BAD_REQUEST" });
  }

  if (!order) {
    return sendJson(res, 400, { ok: false, error: "INVALID_ORDER" });
  }

  try {
    const result = await saveOrder(order);
    const saved = result.saved;
    const createdAt = new Date(saved.creado_en || Date.now()).getTime();

    return sendJson(res, 200, {
      ok: true,
      saved: true,
      operational: result.operational,
      merged: Boolean(saved.merged),
      duplicate: Boolean(saved.duplicate),
      database_id: saved.id,
      order_id: saved.order_id,
      incoming_order_id: saved.incomingOrderId,
      estado: saved.estado,
      estado_armado: saved.estado_armado || "pendiente",
      estado_facturacion: saved.estado_facturacion || "pendiente",
      total_uyu: clampInteger(saved.total_uyu, 0, 1000000000),
      expires_at: new Date(createdAt + ACTIVE_WINDOW_MS).toISOString(),
    });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    console.error("[order-history]", String(error?.message || error));
    return sendJson(res, status, {
      ok: false,
      error: status === 400 ? String(error?.message || "INVALID_ORDER") : "ORDER_SAVE_FAILED",
      message: status === 500 ? String(error?.message || error) : undefined,
    });
  }
}
