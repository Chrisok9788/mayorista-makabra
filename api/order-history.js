export const config = { runtime: "nodejs" };

const DELIVERY_CODE_REGEX = /^\d{7}$/;
const MAX_ITEMS = 200;

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
    throw new Error(`Supabase ${response.status}: ${text.slice(0, 900)}`);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return [];

  return items
    .map((item) => {
      const cantidad = Math.max(0, Math.trunc(Number(item?.qty) || 0));
      const precioUnitario = Math.max(0, Math.round(Number(item?.unitPriceRounded) || 0));
      const subtotalRecibido = Math.max(0, Math.round(Number(item?.subtotalRounded) || 0));
      const subtotalCalculado = Math.round(precioUnitario * cantidad);

      return {
        producto_id: toStr(item?.productId || item?.id) || null,
        nombre: toStr(item?.name).slice(0, 300),
        cantidad,
        precio_unitario_uyu: precioUnitario,
        subtotal_uyu: subtotalRecibido || subtotalCalculado,
      };
    })
    .filter((item) => item.nombre && item.cantidad > 0);
}

function parseOrderPayload(body) {
  const payload = body && typeof body === "object" ? body : null;
  if (!payload) return null;

  const orderId = toStr(payload.orderId).slice(0, 80);
  const customerKey = toStr(payload.customerKey).slice(0, 100);
  const customerLabel = toStr(payload.customerLabel || customerKey).slice(0, 100);
  const items = normalizeItems(payload.items);

  if (!orderId || !customerKey || !items.length) return null;
  if (!/^MK-[A-Z0-9-]+$/i.test(orderId)) return null;

  const keyCode = customerKey.startsWith("C-") ? sanitizeCode(customerKey.slice(2)) : "";
  const suppliedCode = sanitizeCode(payload.deliveryCode);
  const deliveryCode = DELIVERY_CODE_REGEX.test(suppliedCode)
    ? suppliedCode
    : DELIVERY_CODE_REGEX.test(keyCode)
      ? keyCode
      : "";

  const totalFromItems = items.reduce((sum, item) => sum + item.subtotal_uyu, 0);
  const totalReceived = Math.max(0, Math.round(Number(payload.totalRounded) || 0));

  return {
    orderId,
    customerKey,
    customerLabel,
    deliveryCode: deliveryCode || null,
    customerName: toStr(payload.customerName).slice(0, 300) || null,
    customerAddress: toStr(payload.customerAddress).slice(0, 500) || null,
    customerPhone: toStr(payload.customerPhone).slice(0, 100) || null,
    items,
    total: totalFromItems || totalReceived,
    hasConsultables: Boolean(payload.hasConsultables),
    message: toStr(payload.messageText).slice(0, 20000) || null,
    createdAt: toStr(payload.createdAt) || new Date().toISOString(),
  };
}

async function loadDeliveryClient(code) {
  if (!code) return null;

  const rows = await supabaseRequest(
    `clientes?select=id,codigo,nombre,direccion,telefono,activo&codigo=eq.${encodeURIComponent(code)}&limit=1`,
    { method: "GET", prefer: "return=representation" },
  );

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function saveOrder(order) {
  const client = await loadDeliveryClient(order.deliveryCode);

  if (order.deliveryCode && (!client || client.activo === false)) {
    const error = new Error("CLIENTE_REPARTO_NO_VALIDO");
    error.statusCode = 400;
    throw error;
  }

  const record = {
    order_id: order.orderId,
    cliente_id: client?.id ?? null,
    cliente_codigo: order.deliveryCode,
    cliente_clave: order.customerKey,
    cliente_nombre: client?.nombre || order.customerName,
    cliente_direccion: client?.direccion || order.customerAddress,
    cliente_telefono: client?.telefono || order.customerPhone,
    estado: "pendiente",
    total_uyu: order.total,
    tiene_consultables: order.hasConsultables,
    items: order.items,
    mensaje: order.message,
    origen: "web_whatsapp",
    creado_en: order.createdAt,
    actualizado_en: new Date().toISOString(),
  };

  const rows = await supabaseRequest("pedidos?on_conflict=order_id", {
    method: "POST",
    prefer: "return=representation,resolution=merge-duplicates",
    body: JSON.stringify(record),
  });

  if (!Array.isArray(rows) || !rows[0]) {
    throw new Error("Supabase no devolvió el pedido guardado");
  }

  return rows[0];
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
    const saved = await saveOrder(order);
    return sendJson(res, 200, {
      ok: true,
      saved: true,
      database_id: saved.id,
      order_id: saved.order_id,
      estado: saved.estado,
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
