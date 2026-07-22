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

  return ordersHandler(req, res);
}
