import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

const DELIVERY_CODE_REGEX = /^(?:\d{5}|\d{7})$/;
const MAX_ITEMS = 200;
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const SCHEMA_CACHE_MS = 60 * 1000;
const BILLING_STATES = new Set(["pendiente", "facturando", "facturado"]);

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

function safeEqual(received, expected) {
  const a = Buffer.from(toStr(received));
  const b = Buffer.from(toStr(expected));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authorizePanel(req) {
  const expected = toStr(process.env.ORDERS_PANEL_PIN);
  if (!expected) {
    const error = new Error("Falta configurar ORDERS_PANEL_PIN en Vercel");
    error.statusCode = 503;
    error.code = "PANEL_PIN_NOT_CONFIGURED";
    throw error;
  }

  if (!safeEqual(req.headers["x-orders-panel-pin"], expected)) {
    const error = new Error("PIN incorrecto");
    error.statusCode = 401;
    error.code = "UNAUTHORIZED";
    throw error;
  }
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

function cutoffIso() {
  return new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
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

  if (!orderId || !customerKey || !/^MK-[A-Z0-9-]+$/i.test(orderId)) return null;

  const suppliedCode = sanitizeCode(payload.deliveryCode);
  const deliveryCode = DELIVERY_CODE_REGEX.test(suppliedCode) ? suppliedCode : "";
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

async function operationalSchemaAvailable(force = false) {
  const now = Date.now();
  if (!force && now - operationalSchemaCache.checkedAt < SCHEMA_CACHE_MS) {
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
    console.warn("[orders] Esquema operativo no disponible:", String(error));
    operationalSchemaCache = { checkedAt: now, available: false };
  }

  return operationalSchemaCache.available;
}

async function requireOperationalSchema() {
  if (await operationalSchemaAvailable(true)) return;
  const error = new Error("Falta ejecutar la migración del panel en Supabase");
  error.statusCode = 503;
  error.code = "PANEL_SCHEMA_NOT_CONFIGURED";
  throw error;
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
  const rows = await supabaseRequest(
    `pedidos?select=id,order_id,cliente_id,cliente_codigo,cliente_clave,cliente_nombre,cliente_telefono,estado,estado_armado,estado_facturacion,total_uyu,tiene_consultables,actualizaciones,creado_en,actualizado_en,ultimo_ingreso_en&cliente_codigo=eq.${encodeURIComponent(deliveryCode)}&creado_en=gte.${encodeURIComponent(cutoffIso())}&order=creado_en.asc&limit=1`,
    { method: "GET", prefer: "return=representation" },
  );
  return Array.isArray(rows) ? rows[0] || null : null;
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

  return supabaseRequest("pedido_items?on_conflict=pedido_order_id,producto_id", {
    method: "POST",
    prefer: "return=representation,resolution=merge-duplicates",
    body: JSON.stringify(records),
  });
}

async function mergeItems(orderId, items) {
  if (!items.length) return [];

  const existingRows = await supabaseRequest(
    `pedido_items?select=producto_id,cantidad,subtotal_uyu,consultable,sector&pedido_order_id=eq.${encodeURIComponent(orderId)}`,
    { method: "GET", prefer: "return=representation" },
  );
  const existingMap = new Map(
    (Array.isArray(existingRows) ? existingRows : []).map((item) => [
      toStr(item.producto_id),
      item,
    ]),
  );
  const now = new Date().toISOString();

  const records = items.map((item) => {
    const existing = existingMap.get(item.productId) || null;
    const quantity = clampInteger(existing?.cantidad, 0, 1000000) + item.qty;
    const subtotal =
      clampInteger(existing?.subtotal_uyu, 0, 1000000000) + item.subtotalRounded;

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
      actualizado_en: now,
    };
  });

  return supabaseRequest("pedido_items?on_conflict=pedido_order_id,producto_id", {
    method: "POST",
    prefer: "return=representation,resolution=merge-duplicates",
    body: JSON.stringify(records),
  });
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

  const rows = await supabaseRequest(
    `pedidos?order_id=eq.${encodeURIComponent(active.order_id)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({
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
      }),
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
  const rows = await supabaseRequest("pedidos?on_conflict=order_id", {
    method: "POST",
    prefer: "return=representation,resolution=merge-duplicates",
    body: JSON.stringify({
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
    }),
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

async function handleOrderPost(req, res) {
  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return sendJson(res, 400, { ok: false, error: "BAD_REQUEST" });
  }

  const order = parseOrderPayload(body);
  if (!order) {
    return sendJson(res, 400, { ok: false, error: "INVALID_ORDER" });
  }

  const client = await loadDeliveryClient(order.deliveryCode);
  if (order.deliveryCode && (!client || client.activo === false)) {
    return sendJson(res, 400, { ok: false, error: "CLIENTE_REPARTO_NO_VALIDO" });
  }

  const operational = await operationalSchemaAvailable();
  const saved = operational
    ? await saveOperationalOrder(order, client)
    : await saveLegacyOrder(order, client);
  const createdAt = new Date(saved.creado_en || Date.now()).getTime();

  return sendJson(res, 200, {
    ok: true,
    saved: true,
    operational,
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
}

async function loadActivePanelOrder(orderId) {
  const rows = await supabaseRequest(
    `pedidos?select=order_id,creado_en,estado_armado,estado_facturacion&order_id=eq.${encodeURIComponent(orderId)}&creado_en=gte.${encodeURIComponent(cutoffIso())}&limit=1`,
    { method: "GET", prefer: "return=representation" },
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadActiveOrdersForPanel() {
  const orders = await supabaseRequest(
    `pedidos?select=order_id,cliente_codigo,cliente_clave,cliente_nombre,cliente_telefono,estado,estado_armado,estado_facturacion,total_uyu,tiene_consultables,actualizaciones,creado_en,actualizado_en,ultimo_ingreso_en&creado_en=gte.${encodeURIComponent(cutoffIso())}&order=creado_en.asc`,
    { method: "GET", prefer: "return=representation" },
  );
  const list = Array.isArray(orders) ? orders : [];
  if (!list.length) return [];

  const safeIds = list
    .map((order) => toStr(order.order_id))
    .filter((id) => /^MK-[A-Z0-9-]+$/i.test(id));

  let items = [];
  if (safeIds.length) {
    const rows = await supabaseRequest(
      `pedido_items?select=pedido_order_id,producto_id,producto_nombre,cantidad,precio_unitario_uyu,subtotal_uyu,consultable,armado,sector,actualizado_en&pedido_order_id=in.(${safeIds.join(",")})&order=sector.asc,producto_nombre.asc`,
      { method: "GET", prefer: "return=representation" },
    );
    items = Array.isArray(rows) ? rows : [];
  }

  const byOrder = new Map();
  for (const item of items) {
    const key = toStr(item.pedido_order_id);
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(item);
  }

  return list.map((order) => {
    const orderItems = byOrder.get(toStr(order.order_id)) || [];
    const prepared = orderItems.filter((item) => Boolean(item.armado)).length;
    const createdMs = new Date(order.creado_en).getTime();

    return {
      ...order,
      items: orderItems,
      progress: {
        prepared,
        total: orderItems.length,
        percent: orderItems.length ? Math.round((prepared / orderItems.length) * 100) : 0,
      },
      expires_at: new Date(createdMs + ACTIVE_WINDOW_MS).toISOString(),
    };
  });
}

async function updateArmItem(orderId, productId, armed) {
  if (!(await loadActivePanelOrder(orderId))) {
    const error = new Error("El pedido ya no está activo en el panel");
    error.statusCode = 404;
    error.code = "ORDER_NOT_ACTIVE";
    throw error;
  }

  const updatedItems = await supabaseRequest(
    `pedido_items?pedido_order_id=eq.${encodeURIComponent(orderId)}&producto_id=eq.${encodeURIComponent(productId)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({
        armado: Boolean(armed),
        actualizado_en: new Date().toISOString(),
      }),
    },
  );
  if (!Array.isArray(updatedItems) || !updatedItems.length) {
    const error = new Error("Producto no encontrado en el pedido");
    error.statusCode = 404;
    error.code = "ITEM_NOT_FOUND";
    throw error;
  }

  const allItems = await supabaseRequest(
    `pedido_items?select=armado&pedido_order_id=eq.${encodeURIComponent(orderId)}`,
    { method: "GET", prefer: "return=representation" },
  );
  const list = Array.isArray(allItems) ? allItems : [];
  const prepared = list.filter((item) => Boolean(item.armado)).length;
  const armStatus =
    list.length > 0 && prepared === list.length
      ? "armado"
      : prepared > 0
        ? "armando"
        : "pendiente";

  const rows = await supabaseRequest(
    `pedidos?order_id=eq.${encodeURIComponent(orderId)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({
        estado: armStatus,
        estado_armado: armStatus,
        actualizado_en: new Date().toISOString(),
      }),
    },
  );

  return {
    order: Array.isArray(rows) ? rows[0] || null : null,
    progress: {
      prepared,
      total: list.length,
      percent: list.length ? Math.round((prepared / list.length) * 100) : 0,
    },
  };
}

async function updateBillingStatus(orderId, status) {
  if (!BILLING_STATES.has(status)) {
    const error = new Error("Estado de facturación inválido");
    error.statusCode = 400;
    error.code = "INVALID_BILLING_STATUS";
    throw error;
  }

  if (!(await loadActivePanelOrder(orderId))) {
    const error = new Error("El pedido ya no está activo en el panel");
    error.statusCode = 404;
    error.code = "ORDER_NOT_ACTIVE";
    throw error;
  }

  const rows = await supabaseRequest(
    `pedidos?order_id=eq.${encodeURIComponent(orderId)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({
        estado_facturacion: status,
        actualizado_en: new Date().toISOString(),
      }),
    },
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function handlePanelGet(req, res) {
  authorizePanel(req);
  await requireOperationalSchema();
  const orders = await loadActiveOrdersForPanel();
  return sendJson(res, 200, {
    ok: true,
    generated_at: new Date().toISOString(),
    active_window_hours: 24,
    orders,
  });
}

async function handlePanelPatch(req, res) {
  authorizePanel(req);
  await requireOperationalSchema();

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return sendJson(res, 400, { ok: false, error: "BAD_REQUEST" });
  }

  const action = toStr(body.action);
  const orderId = toStr(body.orderId).slice(0, 80);
  if (!/^MK-[A-Z0-9-]+$/i.test(orderId)) {
    return sendJson(res, 400, { ok: false, error: "INVALID_ORDER_ID" });
  }

  if (action === "toggle_item") {
    const productId = toStr(body.productId).slice(0, 160);
    if (!productId) {
      return sendJson(res, 400, { ok: false, error: "INVALID_PRODUCT_ID" });
    }
    const result = await updateArmItem(orderId, productId, Boolean(body.armed));
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (action === "set_billing_status") {
    const order = await updateBillingStatus(orderId, toStr(body.status));
    return sendJson(res, 200, { ok: true, order });
  }

  return sendJson(res, 400, { ok: false, error: "INVALID_ACTION" });
}

export default async function handler(req, res) {
  try {
    if (req.method === "POST") return await handleOrderPost(req, res);
    if (req.method === "GET") return await handlePanelGet(req, res);
    if (req.method === "PATCH") return await handlePanelPatch(req, res);

    res.setHeader("Allow", "GET, POST, PATCH");
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    const code = error?.code || (status === 500 ? "ORDER_API_FAILED" : "REQUEST_FAILED");
    console.error("[order-history]", String(error?.message || error));
    return sendJson(res, status, {
      ok: false,
      error: code,
      message: String(error?.message || error),
    });
  }
}
