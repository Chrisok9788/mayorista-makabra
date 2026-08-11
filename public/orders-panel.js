const REFRESH = 6000;
const TOKEN_KEY = "makabra_orders_access_token";
const REFRESH_KEY = "makabra_orders_refresh_token";
const PIN_KEY = "makabra_orders_panel_pin";

const s = {
  token: sessionStorage.getItem(TOKEN_KEY) || "",
  refreshToken: sessionStorage.getItem(REFRESH_KEY) || "",
  pin: sessionStorage.getItem(PIN_KEY) || "",
  actor: null,
  orders: [],
  missing: [],
  employees: [],
  performance: null,
  filter: "all",
  view: "orders",
  busy: false,
  open: new Set(),
  timer: null,
  assignmentEnabled: true,
};

const $ = (q) => document.querySelector(q);
const e = {
  login: $("#loginView"),
  panel: $("#panelView"),
  form: $("#loginForm"),
  pinForm: $("#pinLoginForm"),
  username: $("#usernameInput"),
  password: $("#passwordInput"),
  pin: $("#pinInput"),
  loginErr: $("#loginError"),
  err: $("#panelError"),
  title: $("#panelTitle"),
  tabs: $("#panelTabs"),
  ordersBadge: $("#ordersBadge"),
  missingBadge: $("#missingBadge"),
  ordersView: $("#ordersView"),
  missingView: $("#missingView"),
  usersView: $("#usersView"),
  performanceView: $("#performanceView"),
  usersTab: $("#usersTab"),
  performanceTab: $("#performanceTab"),
  ordersList: $("#ordersList"),
  missingList: $("#missingList"),
  summary: $("#summary"),
  missingSummary: $("#missingSummary"),
  performanceSummary: $("#performanceSummary"),
  performanceRows: $("#performanceRows"),
  performancePeriod: $("#performancePeriod"),
  performanceFrom: $("#performanceFrom"),
  performanceTo: $("#performanceTo"),
  performanceFromWrap: $("#performanceFromWrap"),
  performanceToWrap: $("#performanceToWrap"),
  reloadPerformance: $("#reloadPerformanceButton"),
  filters: $("#filters"),
  updated: $("#lastUpdated"),
  refresh: $("#refreshButton"),
  logout: $("#logoutButton"),
  staffChip: $("#staffChip"),
  employeeForm: $("#employeeForm"),
  employeeName: $("#employeeName"),
  employeeUsername: $("#employeeUsername"),
  employeePassword: $("#employeePassword"),
  employeeRole: $("#employeeRole"),
  employeesList: $("#employeesList"),
  reloadUsers: $("#reloadUsersButton"),
};

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");
const money = (v) => `$ ${Math.max(0, Math.round(Number(v) || 0)).toLocaleString("es-UY")}`;
const date = (v) => new Date(v);
const valid = (d) => Number.isFinite(d.getTime());
const clock = (v) => {
  const d = date(v);
  return valid(d) ? new Intl.DateTimeFormat("es-UY", { hour: "2-digit", minute: "2-digit" }).format(d) : "—";
};
const dateTime = (v) => {
  const d = date(v);
  return valid(d) ? new Intl.DateTimeFormat("es-UY", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d) : "—";
};

function duration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "—";
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function age(v) {
  const t = date(v).getTime();
  if (!Number.isFinite(t)) return "Hora desconocida";
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (m < 1) return "Hace menos de 1 min";
  if (m < 60) return `Hace ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h < 24 ? (r ? `Hace ${h} h ${r} min` : `Hace ${h} h`) : `Hace ${Math.floor(h / 24)} día(s)`;
}

function remaining(v) {
  const t = date(v).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.ceil((t - Date.now()) / 60000));
  if (!m) return "Sale del panel ahora";
  if (m < 60) return `Sale en ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `Sale en ${h} h ${r} min` : `Sale en ${h} h`;
}

const armLabel = (x) => x === "armado" ? "Armado" : x === "armando" ? "Armando" : "Pendiente";
const armClass = (x) => x === "armado" ? "ready" : x === "armando" ? "working" : "pending";
const bill = (x) => x === "facturado" ? "Facturado" : x === "facturando" ? "Facturando" : "Pendiente";
const itemState = (x) => x?.faltante ? "faltante" : x?.armado ? "armado" : "pendiente";

function error(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function stop() {
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
}

function setSession(data) {
  s.token = data?.access_token || "";
  s.refreshToken = data?.refresh_token || "";
  s.actor = data?.actor || null;
  if (s.token) sessionStorage.setItem(TOKEN_KEY, s.token); else sessionStorage.removeItem(TOKEN_KEY);
  if (s.refreshToken) sessionStorage.setItem(REFRESH_KEY, s.refreshToken); else sessionStorage.removeItem(REFRESH_KEY);
}

function clearSession() {
  s.token = "";
  s.refreshToken = "";
  s.pin = "";
  s.actor = null;
  s.orders = [];
  s.missing = [];
  s.employees = [];
  s.performance = null;
  s.open.clear();
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(PIN_KEY);
}

function login() {
  stop();
  e.panel.hidden = true;
  e.login.hidden = false;
  e.password.value = "";
  if (e.pin) e.pin.value = "";
  setTimeout(() => e.username.focus(), 50);
}

function updateActorUI() {
  const a = s.actor;
  if (!a) {
    e.staffChip.innerHTML = "";
    e.usersTab.hidden = true;
    e.performanceTab.hidden = true;
    return;
  }
  e.staffChip.innerHTML = `<strong>${esc(a.name || a.username || "Usuario")}</strong><span class="role-pill">${esc(a.role || "empleado")}</span>${a.legacy ? '<span class="muted">PIN temporal</span>' : ""}`;
  const admin = a.role === "admin";
  e.usersTab.hidden = !admin;
  e.performanceTab.hidden = !admin;
  if (!admin && (s.view === "users" || s.view === "performance")) s.view = "orders";
}

function panel() {
  e.login.hidden = true;
  e.panel.hidden = false;
  updateActorUI();
  stop();
  s.timer = setInterval(() => {
    if (document.hidden) return;
    if (s.view === "orders" || s.view === "missing") load(true);
  }, REFRESH);
}

function logout() {
  clearSession();
  error(e.err, "");
  error(e.loginErr, "");
  login();
}

async function rawRequest(method = "GET", body, extra = {}) {
  const headers = { Accept: "application/json", "Content-Type": "application/json", ...(extra.headers || {}) };
  if (s.token) headers.Authorization = `Bearer ${s.token}`;
  else if (s.pin) headers["x-orders-panel-pin"] = s.pin;
  const r = await fetch("/api/orders-panel", {
    method,
    cache: "no-store",
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let d = null;
  try { d = await r.json(); } catch {}
  return { r, d };
}

async function refreshSession() {
  if (!s.refreshToken) return false;
  const { r, d } = await rawRequest("PUT", { action: "employee_refresh", refresh_token: s.refreshToken }, { headers: { Authorization: "" } });
  if (!r.ok || d?.ok !== true) return false;
  setSession(d);
  updateActorUI();
  return true;
}

async function api(method = "GET", body, retry = true) {
  let { r, d } = await rawRequest(method, body);
  if (r.status === 401 && s.token && retry && await refreshSession()) return api(method, body, false);
  if (!r.ok || d?.ok !== true) {
    const x = new Error(d?.message || d?.error || `HTTP ${r.status}`);
    x.status = r.status;
    x.code = d?.error || "REQUEST_FAILED";
    x.data = d;
    throw x;
  }
  if (d.actor) {
    s.actor = d.actor;
    updateActorUI();
  }
  return d;
}

async function loginEmployee(username, password) {
  const { r, d } = await rawRequest("PUT", { action: "employee_login", username, password }, { headers: { Authorization: "" } });
  if (!r.ok || d?.ok !== true) {
    const x = new Error(d?.message || "Usuario o contraseña incorrectos");
    x.status = r.status;
    throw x;
  }
  setSession(d);
  s.pin = "";
  sessionStorage.removeItem(PIN_KEY);
  return d;
}

function remember() {
  document.querySelectorAll("details.order-card[open]").forEach((x) => {
    if (x.dataset.orderId) s.open.add(x.dataset.orderId);
  });
}

function cards(el, rows) {
  if (!el) return;
  el.innerHTML = rows.map(([v, l, c = ""]) => `<article class="summary-card ${c}"><strong class="summary-value">${esc(v)}</strong><span class="summary-label">${esc(l)}</span></article>`).join("");
}

function summaries() {
  const pending = s.orders.filter((x) => (x.estado_armado || "pendiente") === "pendiente").length;
  const working = s.orders.filter((x) => x.estado_armado === "armando").length;
  const ready = s.orders.filter((x) => x.estado_armado === "armado").length;
  const mine = s.orders.filter((x) => x.assignment_mine).length;
  const units = s.missing.reduce((a, x) => a + (Number(x.cantidad_total) || 0), 0);
  cards(e.summary, [[s.orders.length, "Activos 24 h"], [mine, "Mis pedidos"], [pending, "Pendientes"], [working, "Armando"], [ready, "Armados"]]);
  const affected = new Set(s.missing.flatMap((x) => Array.isArray(x.pedidos) ? x.pedidos : [])).size;
  const sectors = new Set(s.missing.map((x) => x.sector || "Sin sector")).size;
  cards(e.missingSummary, [[s.missing.length, "Artículos distintos", "warning-card"], [units, "Unidades a reponer", "warning-card"], [affected, "Pedidos afectados"], [sectors, "Sectores"]]);
}

function assignmentLabel(o) {
  if (o.completado_nombre) return `Completado por ${o.completado_nombre}`;
  if (o.asignado_nombre) return `Asignado a ${o.asignado_nombre}`;
  if (o.asignado_usuario) return `Asignado a ${o.asignado_usuario}`;
  return "Sin asignar";
}

function responsibilityMeta(o) {
  const bits = [];
  if (o.asignado_nombre || o.asignado_usuario) bits.push(`<span class="meta-pill">Responsable: ${esc(o.asignado_nombre || o.asignado_usuario)}</span>`);
  else bits.push('<span class="meta-pill">Sin responsable</span>');
  if (o.asignado_en) bits.push(`<span class="meta-pill">Tomado ${esc(dateTime(o.asignado_en))}</span>`);
  if (o.completado_nombre || o.completado_usuario) bits.push(`<span class="meta-pill">Hecho por: ${esc(o.completado_nombre || o.completado_usuario)}</span>`);
  return bits.join("");
}

function billingButtons(o) {
  return [["pendiente", "Pendiente"], ["facturando", "Facturando"], ["facturado", "Facturado"]]
    .map(([v, l]) => `<button type="button" class="billing-button ${(o.estado_facturacion || "pendiente") === v ? "active" : ""}" data-action="billing" data-order-id="${esc(o.order_id)}" data-status="${v}">${l}</button>`)
    .join("");
}

function itemButtons(o, i) {
  const cur = itemState(i);
  return `<div class="item-actions"><button type="button" class="item-state-button armed ${cur === "armado" ? "active" : ""}" data-action="item-status" data-order-id="${esc(o.order_id)}" data-product-id="${esc(i.producto_id)}" data-status="armado" data-current-status="${cur}">Armado</button><button type="button" class="item-state-button missing ${cur === "faltante" ? "active" : ""}" data-action="item-status" data-order-id="${esc(o.order_id)}" data-product-id="${esc(i.producto_id)}" data-status="faltante" data-current-status="${cur}">Falta</button></div>`;
}

function items(o) {
  const groups = new Map();
  for (const i of o.items || []) {
    const sec = String(i.sector || "Sin sector").trim() || "Sin sector";
    if (!groups.has(sec)) groups.set(sec, []);
    groups.get(sec).push(i);
  }
  if (!groups.size) return '<p class="empty-state">Este pedido todavía no tiene productos detallados.</p>';
  return [...groups].map(([sec, list]) => `<section class="sector-group"><h3 class="sector-title">${esc(sec)}</h3>${list.map((i) => {
    const st = itemState(i);
    const note = i.consultable ? "Consultar precio" : `${money(i.precio_unitario_uyu)} c/u`;
    return `<article class="item-row ${st}"><div class="item-main"><div><span class="item-name">${esc(i.producto_nombre)}</span><span class="item-note">${esc(note)}</span>${st === "faltante" ? '<span class="missing-label">Sin stock</span>' : ""}</div><strong class="item-qty">× ${Math.max(0, Number(i.cantidad) || 0)}</strong></div>${itemButtons(o, i)}</article>`;
  }).join("")}</section>`).join("");
}

function completeBlock(o) {
  const p = o.progress || { pending: 0, total: 0, missing: 0 };
  const done = o.estado_armado === "armado";
  const can = p.total > 0 && p.pending === 0 && !done;
  const msg = done ? `Finalizado con ${p.missing || 0} artículo(s) faltante(s).` : p.pending > 0 ? `Quedan ${p.pending} artículo(s) sin resolver.` : "Todos los artículos están armados o marcados como faltantes.";
  return `<section class="completion-block"><div><strong>${done ? "Pedido armado" : "Cerrar armado"}</strong><span>${esc(msg)}</span></div><button type="button" class="complete-order-button ${done ? "completed" : ""}" data-action="complete-order" data-order-id="${esc(o.order_id)}" ${can ? "" : "disabled"}>${done ? "Armado" : "Marcar pedido armado"}</button></section>`;
}

function orderSummary(o) {
  const p = o.progress || { handled: 0, missing: 0, total: 0, percent: 0 };
  const handled = Math.max(0, Number(p.handled ?? p.resolved) || 0);
  const st = o.estado_armado || "pendiente";
  const customer = o.cliente_nombre || o.cliente_clave || "Cliente sin nombre";
  const phone = o.cliente_telefono ? `Tel. ${o.cliente_telefono}` : "";
  const updates = Math.max(1, Number(o.actualizaciones) || 1);
  return `<div class="order-summary-top"><div><span class="order-id">${esc(o.order_id)}</span><span class="customer-name">${esc(customer)}</span></div><strong class="order-total">${money(o.total_uyu)}</strong></div><div class="order-meta"><span class="status-pill ${armClass(st)}">${armLabel(st)}</span><span class="meta-pill">Factura: ${bill(o.estado_facturacion)}</span><span class="meta-pill">${handled}/${p.total} resueltos</span>${p.missing ? `<span class="meta-pill missing-pill">${p.missing} faltante(s)</span>` : ""}${updates > 1 ? `<span class="meta-pill">${updates} pedidos sumados</span>` : ""}${responsibilityMeta(o)}</div><div class="progress-track"><div class="progress-bar" style="width:${Math.min(100, Math.max(0, p.percent))}%"></div></div><div class="order-meta"><span>${esc(age(o.creado_en))}</span><span>Creado ${esc(clock(o.creado_en))}</span><span>${esc(remaining(o.expires_at))}</span>${phone ? `<span>${esc(phone)}</span>` : ""}</div>`;
}

function lockedOrder(o) {
  const taken = Boolean(o.asignado_usuario_id);
  const mine = Boolean(o.assignment_mine);
  const role = s.actor?.role || "empleado";
  if (role !== "empleado" || mine) return null;
  const button = !taken && s.assignmentEnabled ? `<button type="button" class="primary-button" data-action="claim-order" data-order-id="${esc(o.order_id)}">Tomar pedido</button>` : "";
  const text = taken ? `Este pedido está siendo realizado por ${esc(o.asignado_nombre || o.asignado_usuario || "otro empleado")}.` : (s.assignmentEnabled ? "Tomá el pedido para abrirlo y comenzar a prepararlo." : "La asignación de pedidos todavía no está habilitada.");
  return `<article class="order-card" data-order-id="${esc(o.order_id)}"><div class="order-summary">${orderSummary(o)}</div><div class="order-body"><section class="workflow-block"><div class="workflow-title"><span>${esc(assignmentLabel(o))}</span></div><p class="muted">${text}</p>${button}</section></div></article>`;
}

function order(o) {
  const locked = lockedOrder(o);
  if (locked) return locked;
  const adminRelease = s.actor?.role === "admin" && o.asignado_usuario_id ? `<button type="button" class="secondary-button" data-action="release-order" data-order-id="${esc(o.order_id)}">Liberar pedido</button>` : "";
  return `<details class="order-card" data-order-id="${esc(o.order_id)}" ${s.open.has(o.order_id) ? "open" : ""}><summary class="order-summary">${orderSummary(o)}</summary><div class="order-body"><section class="workflow-block"><div class="workflow-title"><span>${esc(assignmentLabel(o))}</span>${adminRelease}</div></section><section class="workflow-block"><div class="workflow-title"><span>Facturación</span><span>${bill(o.estado_facturacion)}</span></div><div class="billing-actions">${billingButtons(o)}</div></section><section class="workflow-block"><div class="workflow-title"><span>Armado del pedido</span><span>${Math.max(0, Number(o.progress?.percent) || 0)}% resuelto</span></div>${items(o)}</section>${completeBlock(o)}</div></details>`;
}

function missingCard(i) {
  const orders = Array.isArray(i.pedidos) ? i.pedidos : [];
  const canResolve = s.actor?.role === "admin" || s.actor?.role === "supervisor";
  return `<article class="missing-card"><div class="missing-card-top"><div><span class="missing-sector">${esc(i.sector || "Sin sector")}</span><h2>${esc(i.producto_nombre)}</h2></div><strong class="missing-quantity">× ${Math.max(0, Number(i.cantidad_total) || 0)}</strong></div><div class="missing-meta"><span>${Math.max(0, Number(i.cantidad_pedidos) || orders.length)} pedido(s)</span><span>Desde ${esc(dateTime(i.marcado_primero_en || i.marcado_en))}</span></div>${orders.length ? `<div class="missing-orders">${orders.map((id) => `<span>${esc(id)}</span>`).join("")}</div>` : ""}${canResolve ? `<button type="button" class="resolve-missing-button" data-action="resolve-missing" data-product-id="${esc(i.producto_id)}">Marcar como recibido / repuesto</button>` : '<p class="muted">Solo supervisores o administradores pueden quitar faltantes de la lista.</p>'}</article>`;
}

function employeeRow(u) {
  const last = u.last_sign_in_at ? `Último ingreso: ${dateTime(u.last_sign_in_at)}` : "Todavía no ingresó";
  return `<article class="user-row ${u.active ? "" : "user-status-off"}" data-user-id="${esc(u.id)}"><div><strong>${esc(u.name)}</strong> · <span>${esc(u.username)}</span><div class="user-meta">${esc(u.role)} · ${u.active ? "Activo" : "Desactivado"} · ${esc(last)}</div></div><div class="user-row-actions"><select data-user-role><option value="empleado" ${u.role === "empleado" ? "selected" : ""}>Empleado</option><option value="supervisor" ${u.role === "supervisor" ? "selected" : ""}>Supervisor</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>Administrador</option></select><button class="secondary-button" type="button" data-action="save-user">Guardar rol</button><button class="secondary-button" type="button" data-action="toggle-user">${u.active ? "Desactivar" : "Activar"}</button></div></article>`;
}

function renderEmployees() {
  e.employeesList.innerHTML = s.employees.length ? s.employees.map(employeeRow).join("") : '<div class="empty-state">Todavía no hay usuarios internos.</div>';
}

function renderPerformance() {
  const data = s.performance || { rows: [], summary: {} };
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const summary = data.summary || {};
  cards(e.performanceSummary, [
    [summary.pedidos || 0, "Pedidos armados"],
    [summary.unidades || 0, "Unidades procesadas"],
    [summary.empleados || 0, "Empleados con actividad"],
    [summary.promedio_pedidos_por_empleado || 0, "Promedio por empleado"],
    [duration(summary.duracion_promedio_segundos), "Tiempo medio de armado"],
  ]);
  e.performanceRows.innerHTML = rows.length ? rows.map((r, index) => `<tr><td><span class="performance-rank">${index + 1}</span></td><td><span class="performance-name">${esc(r.nombre || r.usuario || "Empleado")}</span><br><span class="muted">${esc(r.usuario || "")}</span></td><td><strong>${Math.max(0, Number(r.pedidos) || 0)}</strong></td><td>${Math.max(0, Number(r.unidades) || 0)}</td><td>${Math.max(0, Number(r.articulos) || 0)}</td><td>${Math.max(0, Number(r.faltantes) || 0)}</td><td>${esc(duration(r.duracion_promedio_segundos))}</td><td>${esc(dateTime(r.ultima_finalizacion))}</td></tr>`).join("") : '<tr><td colspan="8"><div class="empty-state">Todavía no hay pedidos armados registrados en este período.</div></td></tr>';
}

function render() {
  summaries();
  const miss = s.view === "missing";
  const users = s.view === "users";
  const performance = s.view === "performance";
  e.ordersView.hidden = miss || users || performance;
  e.missingView.hidden = !miss;
  e.usersView.hidden = !users;
  e.performanceView.hidden = !performance;
  e.title.textContent = users ? "Usuarios internos" : performance ? "Rendimiento de empleados" : miss ? "Artículos faltantes" : "Pedidos activos";
  e.ordersBadge.textContent = s.orders.length;
  e.missingBadge.textContent = s.missing.length;
  e.tabs.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === s.view));
  document.title = performance ? "Rendimiento | Makabra" : miss ? `(${s.missing.length}) Faltantes | Makabra` : users ? "Usuarios | Makabra" : `(${s.orders.length}) Pedidos | Makabra`;
  if (users) {
    renderEmployees();
    return;
  }
  if (performance) {
    renderPerformance();
    return;
  }
  if (miss) {
    e.missingList.innerHTML = s.missing.length ? s.missing.map(missingCard).join("") : '<div class="empty-state success-empty">No hay artículos pendientes de reposición.</div>';
    return;
  }
  const list = s.orders.filter((o) => s.filter === "all" || (s.filter === "pending" && (o.estado_armado || "pendiente") === "pendiente") || (s.filter === "assembling" && o.estado_armado === "armando") || (s.filter === "ready" && o.estado_armado === "armado"));
  e.ordersList.innerHTML = list.length ? list.map(order).join("") : '<div class="empty-state">No hay pedidos en este filtro dentro de las últimas 24 horas.</div>';
}

async function load(silent = false) {
  if (s.busy) return;
  s.busy = true;
  remember();
  if (!silent) {
    e.refresh.disabled = true;
    e.refresh.textContent = "Actualizando…";
  }
  try {
    const d = await api();
    s.orders = Array.isArray(d.orders) ? d.orders : [];
    s.missing = Array.isArray(d.missing_items) ? d.missing_items : [];
    s.assignmentEnabled = d.assignment_enabled !== false;
    if (d.assignment_schema_error) error(e.err, d.assignment_schema_error); else error(e.err, "");
    e.updated.textContent = `Actualizado ${clock(d.generated_at)}`;
    render();
  } catch (x) {
    if (x.status === 401) {
      logout();
      error(e.loginErr, "Usuario, contraseña o sesión no válidos.");
      return;
    }
    const schemaError = x.code === "PANEL_SCHEMA_NOT_CONFIGURED" || x.code === "MISSING_ITEMS_SCHEMA_NOT_CONFIGURED";
    error(e.err, schemaError ? "Falta ejecutar una migración del panel en Supabase." : x.message || "No se pudo cargar el panel.");
  } finally {
    s.busy = false;
    e.refresh.disabled = false;
    e.refresh.textContent = "Actualizar";
  }
}

async function action(btn, body, msg) {
  btn.disabled = true;
  try {
    await api("PATCH", body);
    await load(true);
  } catch (x) {
    error(e.err, x.message || msg);
  } finally {
    btn.disabled = false;
  }
}

async function loadEmployees() {
  if (s.actor?.role !== "admin") return;
  try {
    const d = await api("PUT", { action: "list_employees" });
    s.employees = Array.isArray(d.employees) ? d.employees : [];
    renderEmployees();
    error(e.err, "");
  } catch (x) {
    error(e.err, x.message || "No se pudieron cargar los usuarios.");
  }
}

async function loadPerformance() {
  if (s.actor?.role !== "admin") return;
  const period = e.performancePeriod?.value || "30";
  const body = {
    action: "list_performance",
    period,
    from: period === "custom" ? e.performanceFrom?.value || "" : "",
    to: period === "custom" ? e.performanceTo?.value || "" : "",
  };
  try {
    const d = await api("PUT", body);
    s.performance = d.performance || { rows: [], summary: {} };
    renderPerformance();
    error(e.err, "");
  } catch (x) {
    error(e.err, x.code === "PERFORMANCE_SCHEMA_NOT_CONFIGURED" ? "Falta ejecutar supabase/rendimiento_empleados.sql en Supabase." : x.message || "No se pudo cargar el rendimiento.");
  }
}

function updateCustomRangeVisibility() {
  const custom = e.performancePeriod?.value === "custom";
  if (e.performanceFromWrap) e.performanceFromWrap.hidden = !custom;
  if (e.performanceToWrap) e.performanceToWrap.hidden = !custom;
}

e.form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const username = e.username.value.trim();
  const password = e.password.value;
  if (!username || !password) return;
  error(e.loginErr, "");
  try {
    await loginEmployee(username, password);
    panel();
    await load();
  } catch (x) {
    error(e.loginErr, x.message || "No se pudo ingresar.");
  }
});

e.pinForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const p = e.pin.value.trim();
  if (!p) return;
  s.pin = p;
  sessionStorage.setItem(PIN_KEY, p);
  s.token = "";
  s.refreshToken = "";
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  error(e.loginErr, "");
  panel();
  await load();
});

e.logout.addEventListener("click", logout);
e.refresh.addEventListener("click", () => {
  if (s.view === "users") return loadEmployees();
  if (s.view === "performance") return loadPerformance();
  return load();
});

e.tabs.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-view]");
  if (!b) return;
  const next = b.dataset.view;
  if ((next === "users" || next === "performance") && s.actor?.role !== "admin") return;
  s.view = ["orders", "missing", "users", "performance"].includes(next) ? next : "orders";
  render();
  if (s.view === "users") await loadEmployees();
  if (s.view === "performance") await loadPerformance();
});

e.filters.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-filter]");
  if (!b) return;
  s.filter = b.dataset.filter || "all";
  e.filters.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("active", x === b));
  render();
});

e.ordersList.addEventListener("toggle", (ev) => {
  const d = ev.target.closest("details.order-card");
  const id = d?.dataset.orderId;
  if (!id) return;
  d.open ? s.open.add(id) : s.open.delete(id);
}, true);

e.ordersList.addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-action]");
  if (!b) return;
  if (b.dataset.action === "claim-order") return action(b, { action: "claim_order", orderId: b.dataset.orderId }, "No se pudo tomar el pedido.");
  if (b.dataset.action === "release-order") {
    if (!confirm("¿Liberar este pedido para que pueda tomarlo otro trabajador?")) return;
    return action(b, { action: "release_order", orderId: b.dataset.orderId }, "No se pudo liberar el pedido.");
  }
  if (b.dataset.action === "item-status") {
    const status = b.dataset.status === b.dataset.currentStatus ? "pendiente" : b.dataset.status;
    return action(b, { action: "set_item_status", orderId: b.dataset.orderId, productId: b.dataset.productId, status }, "No se pudo actualizar el artículo.");
  }
  if (b.dataset.action === "complete-order") return action(b, { action: "set_order_assembly_status", orderId: b.dataset.orderId, status: "armado" }, "No se pudo cerrar el armado.");
  if (b.dataset.action === "billing") return action(b, { action: "set_billing_status", orderId: b.dataset.orderId, status: b.dataset.status }, "No se pudo actualizar la facturación.");
});

e.missingList.addEventListener("click", (ev) => {
  const b = ev.target.closest('[data-action="resolve-missing"]');
  if (!b || !confirm("¿Marcar este artículo como recibido o repuesto y quitarlo de la lista de faltantes?")) return;
  action(b, { action: "resolve_missing_product", productId: b.dataset.productId }, "No se pudo resolver el faltante.");
});

e.employeeForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const body = {
    action: "create_employee",
    name: e.employeeName.value.trim(),
    username: e.employeeUsername.value.trim(),
    password: e.employeePassword.value,
    role: e.employeeRole.value,
  };
  const btn = e.employeeForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await api("PUT", body);
    e.employeeForm.reset();
    await loadEmployees();
  } catch (x) {
    error(e.err, x.message || "No se pudo crear el usuario.");
  } finally {
    btn.disabled = false;
  }
});

e.employeesList?.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button[data-action]");
  const row = b?.closest("[data-user-id]");
  if (!b || !row) return;
  const u = s.employees.find((x) => x.id === row.dataset.userId);
  if (!u) return;
  b.disabled = true;
  try {
    if (b.dataset.action === "save-user") await api("PUT", { action: "update_employee", id: u.id, role: row.querySelector("[data-user-role]")?.value });
    if (b.dataset.action === "toggle-user") await api("PUT", { action: "update_employee", id: u.id, active: !u.active });
    await loadEmployees();
  } catch (x) {
    error(e.err, x.message || "No se pudo actualizar el usuario.");
  } finally {
    b.disabled = false;
  }
});

e.reloadUsers?.addEventListener("click", loadEmployees);
e.reloadPerformance?.addEventListener("click", loadPerformance);
e.performancePeriod?.addEventListener("change", async () => {
  updateCustomRangeVisibility();
  if (e.performancePeriod.value !== "custom") await loadPerformance();
});
e.performanceFrom?.addEventListener("change", () => {
  if (e.performancePeriod?.value === "custom" && e.performanceFrom.value && e.performanceTo?.value) loadPerformance();
});
e.performanceTo?.addEventListener("change", () => {
  if (e.performancePeriod?.value === "custom" && e.performanceTo.value && e.performanceFrom?.value) loadPerformance();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden || !(s.token || s.pin)) return;
  if (s.view === "users") loadEmployees();
  else if (s.view === "performance") loadPerformance();
  else load(true);
});

updateCustomRangeVisibility();
if (s.token || s.pin) {
  panel();
  load();
} else {
  login();
}
