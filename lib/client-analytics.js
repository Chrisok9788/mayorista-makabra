const MAX_ORDER_DETAILS = 50;

function toStr(value) {
  return String(value ?? "").trim();
}

function toNonNegativeInteger(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function earlier(current, candidate) {
  const next = validDate(candidate);
  if (!next) return current || null;
  const previous = validDate(current);
  return !previous || next < previous ? next.toISOString() : previous.toISOString();
}

function later(current, candidate) {
  const next = validDate(candidate);
  if (!next) return current || null;
  const previous = validDate(current);
  return !previous || next > previous ? next.toISOString() : previous.toISOString();
}

function clientRecord(row, registered = true) {
  return {
    id: row?.id ?? null,
    codigo: toStr(row?.codigo),
    nombre: toStr(row?.nombre) || "Cliente sin nombre",
    direccion: toStr(row?.direccion),
    telefono: toStr(row?.telefono),
    tipo: toStr(row?.tipo) || "reparto",
    activo: registered ? row?.activo !== false : false,
    observaciones: toStr(row?.observaciones),
    origen: registered ? toStr(row?.origen) || "supabase" : "historial",
    creado_en: row?.creado_en || null,
    registrado: registered,
    pedidos: 0,
    monto_total: 0,
    ticket_promedio: 0,
    primera_compra: null,
    ultima_compra: null,
    detalle_pedidos: [],
  };
}

function orderActivityAt(order) {
  return order?.ultimo_ingreso_en || order?.actualizado_en || order?.creado_en || null;
}

function historicalClient(order) {
  return clientRecord({
    codigo: toStr(order?.cliente_codigo),
    nombre: toStr(order?.cliente_nombre || order?.cliente_clave) || "Cliente histórico",
    telefono: toStr(order?.cliente_telefono),
  }, false);
}

export function buildClientAnalytics(clientRows = [], orderRows = []) {
  const clients = Array.isArray(clientRows) ? clientRows : [];
  const orders = Array.isArray(orderRows) ? orderRows : [];
  const records = new Map();
  const keyById = new Map();
  const keyByCode = new Map();

  clients.forEach((row, index) => {
    const id = row?.id ?? null;
    const code = toStr(row?.codigo);
    const key = id !== null && id !== undefined ? `id:${id}` : `client:${code || index}`;
    records.set(key, clientRecord(row, true));
    if (id !== null && id !== undefined) keyById.set(String(id), key);
    if (code) keyByCode.set(code, key);
  });

  orders.forEach((order, index) => {
    const id = order?.cliente_id ?? null;
    const code = toStr(order?.cliente_codigo);
    let key = id !== null && id !== undefined ? keyById.get(String(id)) : null;
    if (!key && code) key = keyByCode.get(code);

    if (!key) {
      const fallback = code || toStr(order?.cliente_clave) || `sin-cliente-${index}`;
      key = `history:${fallback}`;
      if (!records.has(key)) records.set(key, historicalClient(order));
      if (code) keyByCode.set(code, key);
    }

    const client = records.get(key);
    if (!client) return;
    const purchases = Math.max(1, toNonNegativeInteger(order?.actualizaciones));
    const amount = toNonNegativeInteger(order?.total_uyu);
    const createdAt = order?.creado_en || orderActivityAt(order);
    const activityAt = orderActivityAt(order) || createdAt;

    client.pedidos += purchases;
    client.monto_total += amount;
    client.primera_compra = earlier(client.primera_compra, createdAt);
    client.ultima_compra = later(client.ultima_compra, activityAt);
    client.detalle_pedidos.push({
      order_id: toStr(order?.order_id),
      fecha: activityAt,
      creado_en: createdAt,
      monto: amount,
      pedidos_acumulados: purchases,
      estado_armado: toStr(order?.estado_armado || order?.estado) || "pendiente",
      estado_facturacion: toStr(order?.estado_facturacion) || "pendiente",
    });
  });

  const rows = [...records.values()].map((client) => {
    client.ticket_promedio = client.pedidos
      ? Math.round(client.monto_total / client.pedidos)
      : 0;
    client.detalle_pedidos.sort((a, b) => {
      const aTime = validDate(a.fecha)?.getTime() || 0;
      const bTime = validDate(b.fecha)?.getTime() || 0;
      return bTime - aTime;
    });
    client.detalle_pedidos = client.detalle_pedidos.slice(0, MAX_ORDER_DETAILS);
    return client;
  });

  rows.sort((a, b) => {
    const aTime = validDate(a.ultima_compra)?.getTime() || 0;
    const bTime = validDate(b.ultima_compra)?.getTime() || 0;
    if (aTime !== bTime) return bTime - aTime;
    return a.nombre.localeCompare(b.nombre, "es");
  });

  const registered = rows.filter((row) => row.registrado);
  const totalOrders = rows.reduce((sum, row) => sum + row.pedidos, 0);
  const totalAmount = rows.reduce((sum, row) => sum + row.monto_total, 0);

  return {
    rows,
    summary: {
      clientes_registrados: registered.length,
      clientes_activos: registered.filter((row) => row.activo).length,
      clientes_con_pedidos: rows.filter((row) => row.pedidos > 0).length,
      pedidos: totalOrders,
      monto_total: totalAmount,
      ticket_promedio: totalOrders ? Math.round(totalAmount / totalOrders) : 0,
    },
  };
}
