const MONTEVIDEO_OFFSET = "-03:00";

function toStr(value) {
  return String(value ?? "").trim();
}

function config() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const serviceRole = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !serviceRole) throw new Error("Supabase no está configurado");
  return { baseUrl, serviceRole };
}

async function request(path, options = {}) {
  const { baseUrl, serviceRole } = config();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { response, data };
}

function startOfTodayIso() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montevideo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T00:00:00${MONTEVIDEO_OFFSET}`;
}

function rangeFromPeriod(period, from, to) {
  const now = new Date();
  if (period === "custom") {
    const start = toStr(from);
    const end = toStr(to);
    return {
      from: start ? new Date(`${start}T00:00:00${MONTEVIDEO_OFFSET}`).toISOString() : null,
      to: end ? new Date(`${end}T23:59:59.999${MONTEVIDEO_OFFSET}`).toISOString() : null,
    };
  }
  if (period === "today") return { from: new Date(startOfTodayIso()).toISOString(), to: null };
  const days = period === "7" ? 7 : period === "30" ? 30 : 0;
  if (!days) return { from: null, to: null };
  return { from: new Date(now.getTime() - days * 86400000).toISOString(), to: null };
}

export async function recordStaffPerformance(orderId, actor) {
  if (!orderId || !actor?.id || actor.legacy) return { saved: false };

  const [orderResult, itemsResult] = await Promise.all([
    request(`pedidos?select=order_id,asignado_en,completado_en&order_id=eq.${encodeURIComponent(orderId)}&limit=1`, { method: "GET" }),
    request(`pedido_items?select=producto_id,cantidad,faltante&pedido_order_id=eq.${encodeURIComponent(orderId)}`, { method: "GET" }),
  ]);

  if (!orderResult.response.ok || !itemsResult.response.ok) {
    return { saved: false, schema_ready: false };
  }

  const order = Array.isArray(orderResult.data) ? orderResult.data[0] : null;
  const items = Array.isArray(itemsResult.data) ? itemsResult.data : [];
  const completedAt = order?.completado_en || new Date().toISOString();
  const assignedAt = order?.asignado_en || null;
  const duration = assignedAt
    ? Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(assignedAt).getTime()) / 1000))
    : null;

  const payload = {
    pedido_id: orderId,
    usuario_id: actor.id,
    usuario: actor.username || null,
    nombre: actor.name || actor.username || null,
    tomado_en: assignedAt,
    completado_en: completedAt,
    duracion_segundos: Number.isFinite(duration) ? duration : null,
    articulos_distintos: items.length,
    unidades_totales: items.reduce((sum, item) => sum + Math.max(0, Number(item?.cantidad) || 0), 0),
    faltantes_distintos: items.filter((item) => item?.faltante === true).length,
  };

  const { response, data } = await request("rendimiento_pedidos?on_conflict=pedido_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: JSON.stringify(payload),
  });

  if (!response.ok) return { saved: false, schema_ready: response.status !== 404, detail: data };
  return { saved: true, row: Array.isArray(data) ? data[0] || payload : payload };
}

export async function listStaffPerformance({ period = "30", from = "", to = "" } = {}) {
  const range = rangeFromPeriod(toStr(period) || "30", from, to);
  const body = {
    p_desde: range.from,
    p_hasta: range.to,
  };
  const { response, data } = await request("rpc/makabra_rendimiento_empleados", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = new Error("Falta ejecutar supabase/rendimiento_empleados.sql en Supabase");
    error.statusCode = 503;
    error.code = "PERFORMANCE_SCHEMA_NOT_CONFIGURED";
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const totalOrders = rows.reduce((sum, row) => sum + (Number(row.pedidos) || 0), 0);
  const totalUnits = rows.reduce((sum, row) => sum + (Number(row.unidades) || 0), 0);
  const totalArticles = rows.reduce((sum, row) => sum + (Number(row.articulos) || 0), 0);
  const weightedSeconds = rows.reduce(
    (sum, row) => sum + (Number(row.duracion_promedio_segundos) || 0) * (Number(row.pedidos) || 0),
    0,
  );

  return {
    period: toStr(period) || "30",
    from: range.from,
    to: range.to,
    rows,
    summary: {
      pedidos: totalOrders,
      unidades: totalUnits,
      articulos: totalArticles,
      empleados: rows.length,
      promedio_pedidos_por_empleado: rows.length ? Math.round((totalOrders / rows.length) * 10) / 10 : 0,
      duracion_promedio_segundos: totalOrders ? Math.round(weightedSeconds / totalOrders) : 0,
      lider: rows[0] || null,
    },
  };
}
