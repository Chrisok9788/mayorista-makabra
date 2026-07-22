import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const BILLING_STATES = new Set(["pendiente", "facturando", "facturado"]);

function toStr(value) {
  return String(value ?? "").trim();
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function safeEqual(received, expected) {
  const a = Buffer.from(toStr(received));
  const b = Buffer.from(toStr(expected));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authorize(req) {
  const expected = toStr(process.env.ORDERS_PANEL_PIN);
  if (!expected) {
    const error = new Error("Falta configurar ORDERS_PANEL_PIN en Vercel");
    error.statusCode = 503;
    error.code = "PANEL_PIN_NOT_CONFIGURED";
    throw error;
  }

  const received = req.headers["x-orders-panel-pin"];
  if (!safeEqual(received, expected)) {
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

async function loadActiveOrder(orderId) {
  const rows = await supabaseRequest(
    `pedidos?select=order_id,creado_en,estado_armado,estado_facturacion&order_id=eq.${encodeURIComponent(orderId)}&creado_en=gte.${encodeURIComponent(cutoffIso())}&limit=1`,
    { method: "GET", prefer: "return=representation" },
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadActiveOrders() {
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
    const filter = safeIds.join(",");
    const rows = await supabaseRequest(
      `pedido_items?select=pedido_order_id,producto_id,producto_nombre,cantidad,precio_unitario_uyu,subtotal_uyu,consultable,armado,sector,actualizado_en&pedido_order_id=in.(${filter})&order=sector.asc,producto_nombre.asc`,
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
  const active = await loadActiveOrder(orderId);
  if (!active) {
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
  const allPrepared = list.length > 0 && prepared === list.length;
  const anyPrepared = prepared > 0;
  const armStatus = allPrepared ? "armado" : anyPrepared ? "armando" : "pendiente";

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

  const active = await loadActiveOrder(orderId);
  if (!active) {
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

async function handlePatch(req, res) {
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
    authorize(req);

    if (req.method === "GET") {
      const orders = await loadActiveOrders();
      return sendJson(res, 200, {
        ok: true,
        generated_at: new Date().toISOString(),
        active_window_hours: 24,
        orders,
      });
    }

    if (req.method === "PATCH") {
      return await handlePatch(req, res);
    }

    res.setHeader("Allow", "GET, PATCH");
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    const code = error?.code || (status === 500 ? "PANEL_REQUEST_FAILED" : "REQUEST_FAILED");
    console.error("[orders-panel]", String(error?.message || error));
    return sendJson(res, status, {
      ok: false,
      error: code,
      message: String(error?.message || error),
    });
  }
}
