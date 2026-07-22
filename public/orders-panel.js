const REFRESH_INTERVAL_MS = 6000;
const PIN_STORAGE_KEY = "makabra_orders_panel_pin";

const state = {
  pin: sessionStorage.getItem(PIN_STORAGE_KEY) || "",
  orders: [],
  filter: "all",
  loading: false,
  openOrders: new Set(),
  refreshTimer: null,
};

const elements = {
  loginView: document.querySelector("#loginView"),
  panelView: document.querySelector("#panelView"),
  loginForm: document.querySelector("#loginForm"),
  pinInput: document.querySelector("#pinInput"),
  loginError: document.querySelector("#loginError"),
  panelError: document.querySelector("#panelError"),
  ordersList: document.querySelector("#ordersList"),
  summary: document.querySelector("#summary"),
  filters: document.querySelector("#filters"),
  lastUpdated: document.querySelector("#lastUpdated"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMoney(value) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  return `$ ${amount.toLocaleString("es-UY")}`;
}

function formatClock(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAge(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Hora desconocida";

  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return "Hace menos de 1 min";
  if (minutes < 60) return `Hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes ? `Hace ${hours} h ${remainingMinutes} min` : `Hace ${hours} h`;
  }

  return `Hace ${Math.floor(hours / 24)} día(s)`;
}

function formatRemaining(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";

  const remainingMinutes = Math.max(0, Math.ceil((time - Date.now()) / 60000));
  if (remainingMinutes <= 0) return "Sale del panel ahora";
  if (remainingMinutes < 60) return `Sale en ${remainingMinutes} min`;

  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return minutes ? `Sale en ${hours} h ${minutes} min` : `Sale en ${hours} h`;
}

function armStatusLabel(status) {
  if (status === "armado") return "Armado";
  if (status === "armando") return "Armando";
  return "Pendiente";
}

function armStatusClass(status) {
  if (status === "armado") return "ready";
  if (status === "armando") return "working";
  return "pending";
}

function billingLabel(status) {
  if (status === "facturado") return "Facturado";
  if (status === "facturando") return "Facturando";
  return "Pendiente";
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function showLogin() {
  stopRefreshTimer();
  elements.panelView.hidden = true;
  elements.loginView.hidden = false;
  elements.pinInput.value = "";
  elements.pinInput.focus();
}

function showPanel() {
  elements.loginView.hidden = true;
  elements.panelView.hidden = false;
  startRefreshTimer();
}

function logout() {
  state.pin = "";
  state.orders = [];
  state.openOrders.clear();
  sessionStorage.removeItem(PIN_STORAGE_KEY);
  showError(elements.panelError, "");
  showError(elements.loginError, "");
  showLogin();
}

async function apiRequest(method = "GET", body = null) {
  const response = await fetch("/api/orders-panel", {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-orders-panel-pin": state.pin,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = data?.error || "REQUEST_FAILED";
    throw error;
  }

  return data;
}

function rememberOpenOrders() {
  document.querySelectorAll("details.order-card[open]").forEach((details) => {
    const orderId = details.dataset.orderId;
    if (orderId) state.openOrders.add(orderId);
  });
}

function renderSummary() {
  const total = state.orders.length;
  const pending = state.orders.filter(
    (order) => (order.estado_armado || "pendiente") === "pendiente",
  ).length;
  const assembling = state.orders.filter(
    (order) => order.estado_armado === "armando",
  ).length;
  const ready = state.orders.filter((order) => order.estado_armado === "armado").length;

  elements.summary.innerHTML = [
    [total, "Activos 24 h"],
    [pending, "Pendientes"],
    [assembling, "Armando"],
    [ready, "Armados"],
  ]
    .map(
      ([value, label]) => `
        <article class="summary-card">
          <strong class="summary-value">${value}</strong>
          <span class="summary-label">${label}</span>
        </article>
      `,
    )
    .join("");
}

function matchesFilter(order) {
  const status = order.estado_armado || "pendiente";
  if (state.filter === "pending") return status === "pendiente";
  if (state.filter === "assembling") return status === "armando";
  if (state.filter === "ready") return status === "armado";
  return true;
}

function groupItems(items) {
  const groups = new Map();
  for (const item of items || []) {
    const sector = String(item.sector || "Sin sector").trim() || "Sin sector";
    if (!groups.has(sector)) groups.set(sector, []);
    groups.get(sector).push(item);
  }
  return groups;
}

function renderBillingButtons(order) {
  const current = order.estado_facturacion || "pendiente";
  const statuses = [
    ["pendiente", "Pendiente"],
    ["facturando", "Facturando"],
    ["facturado", "Facturado"],
  ];

  return statuses
    .map(
      ([status, label]) => `
        <button
          type="button"
          class="billing-button ${current === status ? "active" : ""}"
          data-action="billing"
          data-order-id="${escapeHtml(order.order_id)}"
          data-status="${status}"
        >${label}</button>
      `,
    )
    .join("");
}

function renderItems(order) {
  const groups = groupItems(order.items);
  if (!groups.size) {
    return '<p class="empty-state">Este pedido todavía no tiene productos detallados.</p>';
  }

  return [...groups.entries()]
    .map(([sector, items]) => {
      const rows = items
        .map((item) => {
          const prepared = Boolean(item.armado);
          const note = item.consultable
            ? "Consultar precio"
            : `${formatMoney(item.precio_unitario_uyu)} c/u`;

          return `
            <label class="item-row ${prepared ? "prepared" : ""}">
              <input
                class="item-check"
                type="checkbox"
                ${prepared ? "checked" : ""}
                data-action="toggle-item"
                data-order-id="${escapeHtml(order.order_id)}"
                data-product-id="${escapeHtml(item.producto_id)}"
              />
              <span>
                <span class="item-name">${escapeHtml(item.producto_nombre)}</span>
                <span class="item-note">${escapeHtml(note)}</span>
              </span>
              <strong class="item-qty">× ${Math.max(0, Number(item.cantidad) || 0)}</strong>
            </label>
          `;
        })
        .join("");

      return `
        <section class="sector-group">
          <h3 class="sector-title">${escapeHtml(sector)}</h3>
          ${rows}
        </section>
      `;
    })
    .join("");
}

function renderOrder(order) {
  const progress = order.progress || { prepared: 0, total: 0, percent: 0 };
  const armStatus = order.estado_armado || "pendiente";
  const customer = order.cliente_nombre || order.cliente_clave || "Cliente sin nombre";
  const phone = order.cliente_telefono ? `Tel. ${order.cliente_telefono}` : "";
  const updates = Math.max(1, Number(order.actualizaciones) || 1);
  const open = state.openOrders.has(order.order_id) ? "open" : "";

  return `
    <details class="order-card" data-order-id="${escapeHtml(order.order_id)}" ${open}>
      <summary class="order-summary">
        <div class="order-summary-top">
          <div>
            <span class="order-id">${escapeHtml(order.order_id)}</span>
            <span class="customer-name">${escapeHtml(customer)}</span>
          </div>
          <strong class="order-total">${formatMoney(order.total_uyu)}</strong>
        </div>

        <div class="order-meta">
          <span class="status-pill ${armStatusClass(armStatus)}">${armStatusLabel(armStatus)}</span>
          <span class="meta-pill">Factura: ${billingLabel(order.estado_facturacion)}</span>
          <span class="meta-pill">${progress.prepared}/${progress.total} productos</span>
          ${updates > 1 ? `<span class="meta-pill">${updates} pedidos sumados</span>` : ""}
        </div>

        <div class="progress-track" aria-label="${progress.percent}% armado">
          <div class="progress-bar" style="width: ${Math.min(100, Math.max(0, progress.percent))}%"></div>
        </div>

        <div class="order-meta">
          <span>${escapeHtml(formatAge(order.creado_en))}</span>
          <span>Creado ${escapeHtml(formatClock(order.creado_en))}</span>
          <span>${escapeHtml(formatRemaining(order.expires_at))}</span>
          ${phone ? `<span>${escapeHtml(phone)}</span>` : ""}
        </div>
      </summary>

      <div class="order-body">
        <section class="workflow-block">
          <div class="workflow-title">
            <span>Facturación</span>
            <span>${billingLabel(order.estado_facturacion)}</span>
          </div>
          <div class="billing-actions">
            ${renderBillingButtons(order)}
          </div>
        </section>

        <section class="workflow-block">
          <div class="workflow-title">
            <span>Armado del pedido</span>
            <span>${progress.percent}%</span>
          </div>
          ${renderItems(order)}
        </section>
      </div>
    </details>
  `;
}

function renderOrders() {
  renderSummary();

  const filtered = state.orders.filter(matchesFilter);
  document.title = `(${state.orders.length}) Pedidos | Makabra`;

  if (!filtered.length) {
    elements.ordersList.innerHTML = `
      <div class="empty-state">
        No hay pedidos en este filtro dentro de las últimas 24 horas.
      </div>
    `;
    return;
  }

  elements.ordersList.innerHTML = filtered.map(renderOrder).join("");
}

async function loadOrders({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  rememberOpenOrders();

  if (!silent) {
    elements.refreshButton.disabled = true;
    elements.refreshButton.textContent = "Actualizando…";
  }

  try {
    const data = await apiRequest("GET");
    state.orders = Array.isArray(data.orders) ? data.orders : [];
    showError(elements.panelError, "");
    elements.lastUpdated.textContent = `Actualizado ${formatClock(data.generated_at)}`;
    renderOrders();
  } catch (error) {
    if (error.status === 401) {
      logout();
      showError(elements.loginError, "PIN incorrecto o sesión vencida.");
      return;
    }

    const message =
      error.code === "PANEL_PIN_NOT_CONFIGURED"
        ? "Falta configurar el PIN del panel en Vercel."
        : error.message || "No se pudieron cargar los pedidos.";
    showError(elements.panelError, message);
  } finally {
    state.loading = false;
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = "Actualizar";
  }
}

async function updateItem(input) {
  const orderId = input.dataset.orderId;
  const productId = input.dataset.productId;
  const armed = input.checked;
  input.disabled = true;

  try {
    await apiRequest("PATCH", {
      action: "toggle_item",
      orderId,
      productId,
      armed,
    });
    await loadOrders({ silent: true });
  } catch (error) {
    input.checked = !armed;
    showError(elements.panelError, error.message || "No se pudo actualizar el producto.");
  } finally {
    input.disabled = false;
  }
}

async function updateBilling(button) {
  const orderId = button.dataset.orderId;
  const status = button.dataset.status;
  button.disabled = true;

  try {
    await apiRequest("PATCH", {
      action: "set_billing_status",
      orderId,
      status,
    });
    await loadOrders({ silent: true });
  } catch (error) {
    showError(elements.panelError, error.message || "No se pudo actualizar la facturación.");
  } finally {
    button.disabled = false;
  }
}

function startRefreshTimer() {
  stopRefreshTimer();
  state.refreshTimer = window.setInterval(() => {
    if (!document.hidden) loadOrders({ silent: true });
  }, REFRESH_INTERVAL_MS);
}

function stopRefreshTimer() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = elements.pinInput.value.trim();
  if (!pin) return;

  state.pin = pin;
  sessionStorage.setItem(PIN_STORAGE_KEY, pin);
  showError(elements.loginError, "");
  showPanel();
  await loadOrders();
});

elements.logoutButton.addEventListener("click", logout);
elements.refreshButton.addEventListener("click", () => loadOrders());

elements.filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;

  state.filter = button.dataset.filter || "all";
  elements.filters.querySelectorAll("[data-filter]").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  renderOrders();
});

elements.ordersList.addEventListener("toggle", (event) => {
  const details = event.target.closest("details.order-card");
  if (!details) return;
  const orderId = details.dataset.orderId;
  if (!orderId) return;
  if (details.open) state.openOrders.add(orderId);
  else state.openOrders.delete(orderId);
}, true);

elements.ordersList.addEventListener("change", (event) => {
  const input = event.target.closest('[data-action="toggle-item"]');
  if (input) updateItem(input);
});

elements.ordersList.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="billing"]');
  if (button) updateBilling(button);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.pin) loadOrders({ silent: true });
});

if (state.pin) {
  showPanel();
  loadOrders();
} else {
  showLogin();
}
