import crypto from "node:crypto";
import ordersHandler from "../lib/orders-api.js";
import { buildClientAnalytics } from "../lib/client-analytics.js";
import { listStaffPerformance, recordStaffPerformance } from "../lib/staff-performance.js";

export const config = { runtime: "nodejs" };

const STAFF_DOMAIN = "staff.makabra.local";
const STAFF_ROLES = new Set(["empleado", "supervisor", "admin"]);
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;
const DATA_PAGE_SIZE = 1000;
const MAX_DATA_ROWS = 100000;
const ASSIGNMENT_FIELDS = [
  "order_id",
  "asignado_usuario_id",
  "asignado_usuario",
  "asignado_nombre",
  "asignado_en",
  "completado_usuario_id",
  "completado_usuario",
  "completado_nombre",
  "completado_en",
].join(",");

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

function toStr(value) {
  return String(value ?? "").trim();
}

function safeEqual(received, expected) {
  const a = Buffer.from(toStr(received));
  const b = Buffer.from(toStr(expected));
  return Boolean(a.length && a.length === b.length && crypto.timingSafeEqual(a, b));
}

function registeredCodeFrom(body) {
  const code = String(body?.deliveryCode || "").replace(/\D/g, "");
  return /^(?:\d{5}|\d{7})$/.test(code) ? code : "";
}

function supabaseAuthConfig() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const serviceRole = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !serviceRole) throw new Error("Supabase Auth no está configurado");
  return { baseUrl, serviceRole };
}

async function authRequest(path, options = {}, userToken = "") {
  const { baseUrl, serviceRole } = supabaseAuthConfig();
  const response = await fetch(`${baseUrl}/auth/v1${path}`, {
    ...options,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${userToken || serviceRole}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
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

async function dataRequest(path, options = {}) {
  const { baseUrl, serviceRole } = supabaseAuthConfig();
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

function normalizeUsername(value) {
  return toStr(value).toLowerCase().replace(/\s+/g, ".");
}

function staffEmail(username) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,32}$/.test(normalized)) return "";
  return `${normalized}@${STAFF_DOMAIN}`;
}

function actorFromUser(user) {
  if (!user) return null;
  const meta = { ...(user.user_metadata || {}), ...(user.app_metadata || {}) };
  const internal = meta.makabra_internal === true;
  const active = meta.active !== false;
  const role = STAFF_ROLES.has(toStr(meta.role)) ? toStr(meta.role) : "empleado";
  if (!internal || !active) return null;
  const username = toStr(meta.username) || toStr(user.email).split("@")[0];
  return {
    id: user.id,
    username,
    name: toStr(meta.name) || username,
    role,
    active: true,
  };
}

function legacyActor(req) {
  const expected = toStr(process.env.ORDERS_PANEL_PIN);
  const received = req.headers["x-orders-panel-pin"];
  if (expected && safeEqual(received, expected)) {
    return { id: "legacy-pin", username: "admin-pin", name: "Administrador temporal", role: "admin", active: true, legacy: true };
  }
  return null;
}

async function authenticateStaff(req) {
  const header = toStr(req.headers.authorization);
  if (/^Bearer\s+/i.test(header)) {
    const token = header.replace(/^Bearer\s+/i, "").trim();
    const { response, data } = await authRequest("/user", { method: "GET" }, token);
    if (!response.ok) return null;
    return actorFromUser(data);
  }
  return legacyActor(req);
}

function requireAdmin(actor) {
  if (actor?.role === "admin") return;
  const error = new Error("Se requiere permiso de administrador");
  error.statusCode = 403;
  error.code = "ADMIN_REQUIRED";
  throw error;
}

function requireSupervisor(actor) {
  if (actor?.role === "admin" || actor?.role === "supervisor") return;
  const error = new Error("Esta acción requiere supervisor o administrador");
  error.statusCode = 403;
  error.code = "SUPERVISOR_REQUIRED";
  throw error;
}

async function loginStaff(body) {
  const email = staffEmail(body.username);
  const password = toStr(body.password);
  if (!email || password.length < 8) {
    return { status: 400, body: { ok: false, error: "INVALID_CREDENTIALS", message: "Usuario o contraseña inválidos" } };
  }
  const { response, data } = await authRequest("/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    return { status: 401, body: { ok: false, error: "INVALID_CREDENTIALS", message: "Usuario o contraseña incorrectos" } };
  }
  const actor = actorFromUser(data?.user);
  if (!actor) {
    return { status: 403, body: { ok: false, error: "STAFF_DISABLED", message: "Este usuario no está habilitado para el panel" } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      actor,
    },
  };
}

async function refreshStaff(body) {
  const refreshToken = toStr(body.refresh_token);
  if (!refreshToken) return { status: 400, body: { ok: false, error: "MISSING_REFRESH_TOKEN" } };
  const { response, data } = await authRequest("/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) return { status: 401, body: { ok: false, error: "SESSION_EXPIRED", message: "La sesión venció" } };
  const actor = actorFromUser(data?.user);
  if (!actor) return { status: 403, body: { ok: false, error: "STAFF_DISABLED", message: "Usuario deshabilitado" } };
  return { status: 200, body: { ok: true, access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in, actor } };
}

async function listEmployees() {
  const { response, data } = await authRequest("/admin/users?page=1&per_page=200", { method: "GET" });
  if (!response.ok) throw new Error(`No se pudieron listar usuarios (${response.status})`);
  const users = Array.isArray(data?.users) ? data.users : [];
  return users
    .map((user) => {
      const meta = { ...(user.user_metadata || {}), ...(user.app_metadata || {}) };
      if (meta.makabra_internal !== true) return null;
      return {
        id: user.id,
        username: toStr(meta.username) || toStr(user.email).split("@")[0],
        name: toStr(meta.name) || toStr(meta.username) || "Usuario",
        role: STAFF_ROLES.has(toStr(meta.role)) ? toStr(meta.role) : "empleado",
        active: meta.active !== false,
        created_at: user.created_at || null,
        last_sign_in_at: user.last_sign_in_at || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

async function createEmployee(body) {
  const email = staffEmail(body.username);
  const username = normalizeUsername(body.username);
  const name = toStr(body.name).slice(0, 120);
  const password = toStr(body.password);
  const role = STAFF_ROLES.has(toStr(body.role)) ? toStr(body.role) : "empleado";
  if (!email || !name || password.length < 8) {
    const error = new Error("Usuario, nombre y contraseña de al menos 8 caracteres son obligatorios");
    error.statusCode = 400;
    error.code = "INVALID_EMPLOYEE";
    throw error;
  }
  const metadata = { makabra_internal: true, active: true, username, name, role };
  const { response, data } = await authRequest("/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata, app_metadata: metadata }),
  });
  if (!response.ok) {
    const error = new Error(data?.msg || data?.message || `No se pudo crear el usuario (${response.status})`);
    error.statusCode = response.status === 422 ? 409 : response.status;
    error.code = "EMPLOYEE_CREATE_FAILED";
    throw error;
  }
  return actorFromUser(data);
}

async function updateEmployee(body) {
  const id = toStr(body.id);
  if (!id) {
    const error = new Error("Falta el usuario");
    error.statusCode = 400;
    throw error;
  }
  const { response: getResponse, data: current } = await authRequest(`/admin/users/${encodeURIComponent(id)}`, { method: "GET" });
  if (!getResponse.ok) {
    const error = new Error("Usuario no encontrado");
    error.statusCode = 404;
    throw error;
  }
  const oldMeta = { ...(current.user_metadata || {}), ...(current.app_metadata || {}) };
  const role = body.role !== undefined && STAFF_ROLES.has(toStr(body.role)) ? toStr(body.role) : (STAFF_ROLES.has(toStr(oldMeta.role)) ? toStr(oldMeta.role) : "empleado");
  const active = body.active !== undefined ? Boolean(body.active) : oldMeta.active !== false;
  const name = body.name !== undefined ? toStr(body.name).slice(0, 120) : toStr(oldMeta.name);
  const metadata = { ...oldMeta, makabra_internal: true, role, active, name };
  const patch = { user_metadata: metadata, app_metadata: metadata };
  if (toStr(body.password)) {
    if (toStr(body.password).length < 8) {
      const error = new Error("La nueva contraseña debe tener al menos 8 caracteres");
      error.statusCode = 400;
      throw error;
    }
    patch.password = toStr(body.password);
  }
  const { response, data } = await authRequest(`/admin/users/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const error = new Error(data?.msg || data?.message || "No se pudo actualizar el usuario");
    error.statusCode = response.status;
    throw error;
  }
  return actorFromUser(data);
}

function clientAnalyticsRange(body) {
  const period = toStr(body?.period) || "30";
  if (period === "all") return { period, from: null, to: null };

  if (period === "custom") {
    const fromValue = toStr(body?.from);
    const toValue = toStr(body?.to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromValue) || !/^\d{4}-\d{2}-\d{2}$/.test(toValue)) {
      const error = new Error("Elegí una fecha inicial y una fecha final");
      error.statusCode = 400;
      error.code = "INVALID_CLIENT_DATE_RANGE";
      throw error;
    }
    const from = new Date(`${fromValue}T00:00:00-03:00`);
    const inclusiveTo = new Date(`${toValue}T00:00:00-03:00`);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(inclusiveTo.getTime()) || inclusiveTo < from) {
      const error = new Error("El período de clientes no es válido");
      error.statusCode = 400;
      error.code = "INVALID_CLIENT_DATE_RANGE";
      throw error;
    }
    const to = new Date(inclusiveTo.getTime() + 24 * 60 * 60 * 1000);
    return { period, from: from.toISOString(), to: to.toISOString() };
  }

  const days = ["30", "90", "365"].includes(period) ? Number(period) : 30;
  return {
    period: String(days),
    from: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    to: null,
  };
}

async function listAllRows(path, errorCode, errorMessage) {
  const rows = [];
  let offset = 0;

  while (offset < MAX_DATA_ROWS) {
    const separator = path.includes("?") ? "&" : "?";
    const { response, data } = await dataRequest(
      `${path}${separator}limit=${DATA_PAGE_SIZE}&offset=${offset}`,
      { method: "GET" },
    );
    if (!response.ok) {
      const error = new Error(errorMessage);
      error.statusCode = 503;
      error.code = errorCode;
      throw error;
    }
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < DATA_PAGE_SIZE) break;
    offset += DATA_PAGE_SIZE;
  }

  return rows;
}

async function listClients(body) {
  const range = clientAnalyticsRange(body);
  const orderFilters = [];
  if (range.from) orderFilters.push(`ultimo_ingreso_en=gte.${encodeURIComponent(range.from)}`);
  if (range.to) orderFilters.push(`ultimo_ingreso_en=lt.${encodeURIComponent(range.to)}`);
  const orderQuery = [
    "pedidos?select=order_id,cliente_id,cliente_codigo,cliente_clave,cliente_nombre,cliente_telefono,estado,estado_armado,estado_facturacion,total_uyu,actualizaciones,creado_en,actualizado_en,ultimo_ingreso_en",
    ...orderFilters,
    "order=ultimo_ingreso_en.desc",
  ].join("&");

  const [clients, orders] = await Promise.all([
    listAllRows(
      "clientes?select=id,codigo,nombre,direccion,telefono,tipo,activo,observaciones,origen,creado_en,actualizado_en&order=nombre.asc",
      "CLIENTS_SCHEMA_NOT_CONFIGURED",
      "No se pudo leer la tabla de clientes",
    ),
    listAllRows(
      orderQuery,
      "CLIENT_ORDERS_NOT_AVAILABLE",
      "No se pudo leer el historial de pedidos",
    ),
  ]);

  return {
    ...buildClientAnalytics(clients, orders),
    period: range,
  };
}

async function createClient(body) {
  const codigo = toStr(body?.codigo).replace(/\D/g, "");
  const nombre = toStr(body?.nombre).slice(0, 180);
  const direccion = toStr(body?.direccion).slice(0, 300);
  const telefono = toStr(body?.telefono).slice(0, 80);
  const observaciones = toStr(body?.observaciones).slice(0, 500);
  const phoneDigits = telefono.replace(/\D/g, "");

  if (!/^\d{7}$/.test(codigo)) {
    const error = new Error("El código debe tener exactamente 7 cifras");
    error.statusCode = 400;
    error.code = "INVALID_CLIENT_CODE";
    throw error;
  }
  if (!nombre || !direccion || phoneDigits.length < 6) {
    const error = new Error("Nombre, dirección y teléfono válido son obligatorios");
    error.statusCode = 400;
    error.code = "INVALID_CLIENT";
    throw error;
  }

  const { response, data } = await dataRequest("clientes", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      codigo,
      nombre,
      direccion,
      telefono,
      tipo: "reparto",
      activo: true,
      observaciones: observaciones || null,
      origen: "panel_admin",
    }),
  });

  if (response.status === 409) {
    const error = new Error("Ya existe un cliente con ese código");
    error.statusCode = 409;
    error.code = "CLIENT_CODE_EXISTS";
    throw error;
  }
  if (!response.ok) {
    const error = new Error("No se pudo guardar el cliente");
    error.statusCode = 503;
    error.code = "CLIENT_CREATE_FAILED";
    throw error;
  }

  const client = Array.isArray(data) ? data[0] || null : null;
  if (!client) {
    const error = new Error("Supabase no devolvió el cliente guardado");
    error.statusCode = 500;
    error.code = "CLIENT_CREATE_FAILED";
    throw error;
  }
  return client;
}

async function handleStaffPut(req, res) {
  let body;
  try { body = parseBody(req); } catch { return sendJson(res, 400, { ok: false, error: "BAD_REQUEST" }); }
  const action = toStr(body.action);
  if (action === "employee_login") {
    const result = await loginStaff(body);
    return sendJson(res, result.status, result.body);
  }
  if (action === "employee_refresh") {
    const result = await refreshStaff(body);
    return sendJson(res, result.status, result.body);
  }
  const actor = await authenticateStaff(req);
  if (!actor) return sendJson(res, 401, { ok: false, error: "UNAUTHORIZED", message: "Sesión no válida" });
  requireAdmin(actor);

  if (action === "list_employees") {
    return sendJson(res, 200, { ok: true, actor, employees: await listEmployees() });
  }
  if (action === "list_performance") {
    const performance = await listStaffPerformance({
      period: body.period,
      from: body.from,
      to: body.to,
    });
    return sendJson(res, 200, { ok: true, actor, performance });
  }
  if (action === "list_clients") {
    const clients = await listClients(body);
    return sendJson(res, 200, { ok: true, actor, clients });
  }
  if (action === "create_client") {
    const client = await createClient(body);
    console.info("[orders-audit]", JSON.stringify({ actor: actor.username, action: "create_client", target: client?.codigo || null, at: new Date().toISOString() }));
    return sendJson(res, 201, { ok: true, actor, client });
  }
  if (action === "create_employee") {
    const employee = await createEmployee(body);
    console.info("[orders-audit]", JSON.stringify({ actor: actor.username, action: "create_employee", target: employee?.username || null, at: new Date().toISOString() }));
    return sendJson(res, 201, { ok: true, actor, employee });
  }
  if (action === "update_employee") {
    const employee = await updateEmployee(body);
    console.info("[orders-audit]", JSON.stringify({ actor: actor.username, action: "update_employee", target: employee?.username || body.id, at: new Date().toISOString() }));
    return sendJson(res, 200, { ok: true, actor, employee });
  }
  return sendJson(res, 400, { ok: false, error: "INVALID_ACTION" });
}

function assignmentCutoffIso() {
  return new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString();
}

async function loadAssignments() {
  const { response, data } = await dataRequest(
    `pedidos?select=${ASSIGNMENT_FIELDS}&creado_en=gte.${encodeURIComponent(assignmentCutoffIso())}`,
    { method: "GET" },
  );
  if (!response.ok) return { enabled: false, rows: [], status: response.status, detail: data };
  return { enabled: true, rows: Array.isArray(data) ? data : [] };
}

async function loadAssignment(orderId) {
  const { response, data } = await dataRequest(
    `pedidos?select=${ASSIGNMENT_FIELDS}&order_id=eq.${encodeURIComponent(orderId)}&limit=1`,
    { method: "GET" },
  );
  if (!response.ok) {
    const error = new Error("Falta aplicar la migración de asignación de pedidos en Supabase");
    error.statusCode = 503;
    error.code = "ORDER_ASSIGNMENT_SCHEMA_NOT_CONFIGURED";
    throw error;
  }
  return Array.isArray(data) ? data[0] || null : null;
}

async function claimOrder(orderId, actor) {
  if (!actor || actor.legacy) {
    const error = new Error("Ingresá con un usuario interno para tomar pedidos");
    error.statusCode = 403;
    error.code = "INDIVIDUAL_LOGIN_REQUIRED";
    throw error;
  }
  if (!/^MK-[A-Z0-9-]+$/i.test(orderId)) {
    const error = new Error("Pedido inválido");
    error.statusCode = 400;
    error.code = "INVALID_ORDER_ID";
    throw error;
  }
  const now = new Date().toISOString();
  const { response, data } = await dataRequest(
    `pedidos?order_id=eq.${encodeURIComponent(orderId)}&creado_en=gte.${encodeURIComponent(assignmentCutoffIso())}&asignado_usuario_id=is.null`,
    {
      method: "PATCH",
      body: JSON.stringify({
        asignado_usuario_id: actor.id,
        asignado_usuario: actor.username,
        asignado_nombre: actor.name,
        asignado_en: now,
      }),
    },
  );
  if (!response.ok) {
    const error = new Error("Falta aplicar la migración de asignación de pedidos en Supabase");
    error.statusCode = 503;
    error.code = "ORDER_ASSIGNMENT_SCHEMA_NOT_CONFIGURED";
    throw error;
  }
  if (Array.isArray(data) && data.length) {
    console.info("[orders-audit]", JSON.stringify({ actor: actor.username, action: "claim_order", order_id: orderId, at: now }));
    return data[0];
  }
  const current = await loadAssignment(orderId);
  if (!current) {
    const error = new Error("El pedido ya no está activo");
    error.statusCode = 404;
    error.code = "ORDER_NOT_ACTIVE";
    throw error;
  }
  if (toStr(current.asignado_usuario_id) === actor.id) return current;
  const error = new Error(`Este pedido ya fue tomado por ${current.asignado_nombre || current.asignado_usuario || "otro empleado"}`);
  error.statusCode = 409;
  error.code = "ORDER_ALREADY_ASSIGNED";
  error.assignment = current;
  throw error;
}

async function releaseOrder(orderId, actor) {
  requireAdmin(actor);
  const { response, data } = await dataRequest(
    `pedidos?order_id=eq.${encodeURIComponent(orderId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        asignado_usuario_id: null,
        asignado_usuario: null,
        asignado_nombre: null,
        asignado_en: null,
      }),
    },
  );
  if (!response.ok) {
    const error = new Error("No se pudo liberar el pedido");
    error.statusCode = 503;
    error.code = "ORDER_ASSIGNMENT_SCHEMA_NOT_CONFIGURED";
    throw error;
  }
  console.info("[orders-audit]", JSON.stringify({ actor: actor.username, action: "release_order", order_id: orderId, at: new Date().toISOString() }));
  return Array.isArray(data) ? data[0] || null : null;
}

async function ensureOrderOwnership(orderId, actor) {
  if (!actor) {
    const error = new Error("Sesión no válida");
    error.statusCode = 401;
    error.code = "UNAUTHORIZED";
    throw error;
  }
  if (actor.role === "admin" || actor.role === "supervisor") return;
  const assignment = await loadAssignment(orderId);
  if (!assignment) {
    const error = new Error("Pedido no encontrado");
    error.statusCode = 404;
    error.code = "ORDER_NOT_FOUND";
    throw error;
  }
  if (!assignment.asignado_usuario_id) {
    const error = new Error("Primero tenés que tomar este pedido");
    error.statusCode = 409;
    error.code = "ORDER_NOT_CLAIMED";
    throw error;
  }
  if (toStr(assignment.asignado_usuario_id) !== actor.id) {
    const error = new Error(`Este pedido pertenece a ${assignment.asignado_nombre || assignment.asignado_usuario || "otro empleado"}`);
    error.statusCode = 403;
    error.code = "ORDER_LOCKED";
    throw error;
  }
}

async function markOrderCompleted(orderId, actor) {
  if (!actor || !orderId) return;
  const completedAt = new Date().toISOString();
  const { response, data } = await dataRequest(
    `pedidos?order_id=eq.${encodeURIComponent(orderId)}&estado_armado=eq.armado`,
    {
      method: "PATCH",
      body: JSON.stringify({
        completado_usuario_id: actor.id,
        completado_usuario: actor.username,
        completado_nombre: actor.name,
        completado_en: completedAt,
      }),
    },
  );
  if (!response.ok) {
    console.warn("[orders-audit] No se pudo registrar quién completó el pedido", orderId);
    return;
  }
  if (!Array.isArray(data) || !data.length) return;

  const saved = await recordStaffPerformance(orderId, actor).catch((error) => ({ saved: false, error }));
  if (!saved?.saved) {
    console.warn("[orders-performance] No se pudo guardar el rendimiento", orderId, saved?.error?.message || saved?.detail || "");
    return;
  }
  console.info("[orders-performance]", JSON.stringify({ actor: actor.username, action: "record_completion", order_id: orderId, at: completedAt }));
}

export default async function handler(req, res) {
  if (req.method === "PUT") {
    try {
      return await handleStaffPut(req, res);
    } catch (error) {
      console.error("[staff-auth]", error?.message || error);
      return sendJson(res, Number(error?.statusCode) || 500, {
        ok: false,
        error: error?.code || "STAFF_AUTH_FAILED",
        message: Number(error?.statusCode) && Number(error?.statusCode) < 500 ? error.message : "No se pudo completar la operación",
      });
    }
  }

  if (req.method === "POST") {
    let body;
    try { body = parseBody(req); } catch { return sendJson(res, 400, { ok: false, error: "BAD_REQUEST" }); }
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

  let actor = null;
  if (req.method === "GET" || req.method === "PATCH") {
    actor = await authenticateStaff(req);
    if (!actor) return sendJson(res, 401, { ok: false, error: "UNAUTHORIZED", message: "Sesión no válida" });
    if (!actor.legacy) req.headers["x-orders-panel-pin"] = toStr(process.env.ORDERS_PANEL_PIN);
  }

  let patchBody = null;
  if (req.method === "PATCH") {
    try { patchBody = parseBody(req); } catch { return sendJson(res, 400, { ok: false, error: "BAD_REQUEST" }); }
    const action = toStr(patchBody.action);
    const orderId = toStr(patchBody.orderId);

    try {
      if (action === "claim_order") {
        const assignment = await claimOrder(orderId, actor);
        return sendJson(res, 200, { ok: true, actor, assignment });
      }
      if (action === "release_order") {
        const assignment = await releaseOrder(orderId, actor);
        return sendJson(res, 200, { ok: true, actor, assignment });
      }
      if (action === "resolve_missing_product") {
        requireSupervisor(actor);
      } else if (orderId) {
        await ensureOrderOwnership(orderId, actor);
      }

      if (action === "complete_order") {
        req.body = { ...patchBody, action: "set_order_assembly_status", status: "armado" };
        patchBody = req.body;
      }

      console.info("[orders-audit]", JSON.stringify({
        actor: actor.username,
        role: actor.role,
        action: req.body?.action || action,
        order_id: orderId || null,
        product_id: patchBody.productId || null,
        at: new Date().toISOString(),
      }));
    } catch (error) {
      return sendJson(res, Number(error?.statusCode) || 500, {
        ok: false,
        error: error?.code || "ORDER_ACCESS_FAILED",
        message: error?.message || "No se pudo acceder al pedido",
        ...(error?.assignment ? { assignment: error.assignment } : {}),
      });
    }
  }

  if (req.method === "GET") {
    const assignments = await loadAssignments();
    const assignmentMap = new Map(assignments.rows.map((row) => [toStr(row.order_id), row]));
    const originalEnd = res.end.bind(res);
    res.end = (chunk, ...args) => {
      try {
        const payload = JSON.parse(String(chunk || "{}"));
        if (payload?.ok === true) {
          payload.actor = actor || legacyActor(req) || null;
          payload.assignment_enabled = assignments.enabled;
          payload.assignment_schema_error = assignments.enabled ? null : "Ejecutá supabase/pedidos_asignacion_empleados.sql en Supabase";
          payload.orders = (Array.isArray(payload.orders) ? payload.orders : [])
            .filter((order) => /^(?:\d{5}|\d{7})$/.test(String(order?.cliente_codigo || "")))
            .map((order) => {
              const assignment = assignmentMap.get(toStr(order.order_id)) || {};
              const mine = actor && toStr(assignment.asignado_usuario_id) === actor.id;
              const canOpen = actor?.role === "admin" || actor?.role === "supervisor" || mine;
              return {
                ...order,
                ...assignment,
                assignment_mine: Boolean(mine),
                can_open: Boolean(canOpen),
                locked: Boolean(assignment.asignado_usuario_id && !canOpen),
                items: canOpen ? order.items : [],
                progress: {
                  ...(order.progress || {}),
                  resolved: Number(order?.progress?.handled) || 0,
                },
              };
            });

          payload.missing_items = (Array.isArray(payload.missing_items) ? payload.missing_items : []).map((item) => ({
            ...item,
            cantidad_pedidos: Array.isArray(item.pedidos) ? item.pedidos.length : 0,
            marcado_en: item.marcado_primero_en || item.marcado_ultimo_en || null,
          }));
          return originalEnd(JSON.stringify(payload), ...args);
        }
      } catch {
        // Se devuelve la respuesta original.
      }
      return originalEnd(chunk, ...args);
    };
  }

  const result = await ordersHandler(req, res);
  if (req.method === "PATCH" && patchBody && actor) {
    const action = toStr(patchBody.action);
    const successful = Number(res.statusCode) >= 200 && Number(res.statusCode) < 300;
    const completedExplicitly = action === "set_order_assembly_status" && toStr(patchBody.status) === "armado";
    const mayHaveCompletedAutomatically = action === "set_item_status" || action === "toggle_item";
    if (successful && (completedExplicitly || mayHaveCompletedAutomatically)) {
      await markOrderCompleted(toStr(patchBody.orderId), actor).catch((error) => console.warn("[orders-audit]", error?.message || error));
    }
  }
  return result;
}
