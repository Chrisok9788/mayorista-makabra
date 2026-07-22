import ordersHandler from "../lib/orders-api.js";

export const config = { runtime: "nodejs" };

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body && typeof req.body === "object" ? req.body : {};
}

function registeredCodeFrom(body) {
  const code = String(body?.deliveryCode || "").replace(/\D/g, "");
  return /^(?:\d{5}|\d{7})$/.test(code) ? code : "";
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    let body;
    try {
      body = parseBody(req);
    } catch {
      return sendJson(res, 400, { ok: false, error: "BAD_REQUEST" });
    }

    // El panel operativo es exclusivo para clientes registrados.
    // Los pedidos anónimos siguen su curso por WhatsApp, pero no se guardan aquí.
    if (!registeredCodeFrom(body)) {
      const incomingOrderId = String(body?.orderId || "").trim() || null;
      return sendJson(res, 200, {
        ok: true,
        saved: false,
        panel_eligible: false,
        reason: "UNREGISTERED_CUSTOMER",
        operational: false,
        merged: false,
        duplicate: false,
        order_id: incomingOrderId,
        incoming_order_id: incomingOrderId,
      });
    }
  }

  if (req.method === "PATCH") {
    try {
      const body = parseBody(req);
      if (body.action === "complete_order") {
        req.body = {
          ...body,
          action: "set_order_assembly_status",
          status: "armado",
        };
      }
    } catch {
      // El controlador principal devolverá BAD_REQUEST.
    }
  }

  if (req.method === "GET") {
    const originalEnd = res.end.bind(res);
    res.end = (chunk, ...args) => {
      try {
        const payload = JSON.parse(String(chunk || "{}"));
        if (payload?.ok === true) {
          // También ocultamos pedidos anónimos antiguos que hayan quedado en la tabla.
          payload.orders = (Array.isArray(payload.orders) ? payload.orders : [])
            .filter((order) => /^(?:\d{5}|\d{7})$/.test(String(order?.cliente_codigo || "")))
            .map((order) => ({
              ...order,
              progress: {
                ...(order.progress || {}),
                resolved: Number(order?.progress?.handled) || 0,
              },
            }));

          payload.missing_items = (
            Array.isArray(payload.missing_items) ? payload.missing_items : []
          ).map((item) => ({
            ...item,
            cantidad_pedidos: Array.isArray(item.pedidos) ? item.pedidos.length : 0,
            marcado_en: item.marcado_primero_en || item.marcado_ultimo_en || null,
          }));
          return originalEnd(JSON.stringify(payload), ...args);
        }
      } catch {
        // Si no es JSON, se devuelve la respuesta original.
      }
      return originalEnd(chunk, ...args);
    };
  }

  return ordersHandler(req, res);
}
