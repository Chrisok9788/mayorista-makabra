import crypto from "node:crypto";
import ordersHandler from "../lib/orders-api.js";

export const config = { runtime: "nodejs" };

const STAFF_DOMAIN = "staff.makabra.local";
const STAFF_ROLES = new Set(["empleado", "supervisor", "admin"]);

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
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
      app_metadata: metadata,
    }),
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

  let actor = null;
  if (req.method === "GET" || req.method === "PATCH") {
    actor = await authenticateStaff(req);
    if (actor && !actor.legacy) {
      // El controlador operativo existente conserva la validación del PIN. Lo inyectamos
      // únicamente del lado servidor después de validar la sesión individual.
      req.headers["x-orders-panel-pin"] = toStr(process.env.ORDERS_PANEL_PIN);
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
      if (actor) {
        console.info("[orders-audit]", JSON.stringify({ actor: actor.username, role: actor.role, action: req.body?.action || body.action, order_id: body.orderId || null, product_id: body.productId || null, at: new Date().toISOString() }));
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
          payload.actor = actor || legacyActor(req) || null;
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
