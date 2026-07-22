import ordersHandler from "../lib/orders-api.js";

export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  if (req.method === "PATCH") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
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
          payload.orders = (Array.isArray(payload.orders) ? payload.orders : []).map((order) => ({
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
