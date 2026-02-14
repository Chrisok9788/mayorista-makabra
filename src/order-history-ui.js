import {
  clearAllHistory,
  clearCustomerHistory,
  getCustomers,
  getOrdersByCustomer,
} from "./order-history.js";

const WA_PHONE = "59896405927";

function formatUYU(value) {
  const safe = Number(value) || 0;
  return `$ ${safe.toLocaleString("es-UY")}`;
}

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  return d.toLocaleString("es-UY");
}

function copyToClipboard(text) {
  const safeText = String(text || "");
  if (!safeText) return;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(safeText).catch(() => {});
    return;
  }

  const area = document.createElement("textarea");
  area.value = safeText;
  area.setAttribute("readonly", "readonly");
  area.style.position = "absolute";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

function getMessageForOrder(order) {
  return String(order?.messageText || order?.messagePreview || "");
}

function openWhatsAppWithOrder(order) {
  const message = getMessageForOrder(order);
  if (!message) return;
  window.location.href = `https://wa.me/${WA_PHONE}?text=${encodeURIComponent(message)}`;
}

function ensureHistoryUI() {
  const nav = document.querySelector(".header-row .main-nav");
  if (nav && !document.getElementById("history-open-btn")) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "history-open-btn";
    button.className = "delivery-open-btn";
    button.textContent = "Historial";
    nav.appendChild(button);
  }

  if (document.getElementById("history-modal")) return;

  const modal = document.createElement("div");
  modal.id = "history-modal";
  modal.className = "delivery-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="delivery-modal-backdrop" data-close-history="1"></div>
    <div class="delivery-modal-card history-modal-card" role="dialog" aria-modal="true" aria-labelledby="history-modal-title">
      <div class="history-head">
        <h3 id="history-modal-title">Historial</h3>
        <button type="button" class="btn" id="history-close">Cerrar</button>
      </div>
      <div id="history-customers" class="history-customers"></div>
      <div id="history-orders" class="history-orders"></div>
      <div class="history-actions">
        <button type="button" class="btn" id="history-clear-customer" disabled>Limpiar cliente</button>
        <button type="button" class="btn" id="history-clear-all">Limpiar todo</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function renderCustomers(activeKey = "") {
  const wrapper = document.getElementById("history-customers");
  if (!wrapper) return "";

  const customers = getCustomers();
  if (!customers.length) {
    wrapper.innerHTML = '<p class="muted">No hay pedidos guardados.</p>';
    return "";
  }

  const selected = customers.some((c) => c.key === activeKey) ? activeKey : customers[0].key;

  wrapper.innerHTML = `
    <div class="history-scroll">
      ${customers
        .map(
          (customer) => `
            <button type="button" class="history-customer-btn ${customer.key === selected ? "active" : ""}" data-customer-key="${customer.key}">
              <strong>${customer.label}</strong>
              <small>${customer.totalOrders} pedidos</small>
            </button>
          `
        )
        .join("")}
    </div>
  `;

  return selected;
}

function renderOrders(customerKey) {
  const wrapper = document.getElementById("history-orders");
  const clearCustomerBtn = document.getElementById("history-clear-customer");
  if (!wrapper || !clearCustomerBtn) return;

  if (!customerKey) {
    clearCustomerBtn.disabled = true;
    wrapper.innerHTML = "";
    return;
  }

  clearCustomerBtn.disabled = false;
  const orders = getOrdersByCustomer(customerKey);

  if (!orders.length) {
    wrapper.innerHTML = '<p class="muted">Sin pedidos para este cliente.</p>';
    return;
  }

  wrapper.innerHTML = `
    <div class="history-list">
      ${orders
        .map(
          (order) => `
            <article class="history-order-card" data-order-id="${order.orderId}">
              <div class="history-order-meta">
                <strong>${order.orderId}</strong>
                <span>${formatDate(order.createdAt)}</span>
              </div>
              <div class="history-order-total">Total: ${formatUYU(order.totalRounded)}</div>
              <div class="history-order-actions">
                <button type="button" class="btn" data-action="copy-order" data-order-id="${order.orderId}">Copiar pedido</button>
                <button type="button" class="btn btn-primary" data-action="resend-order" data-order-id="${order.orderId}">Reenviar a WhatsApp</button>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function refreshHistory(customerKey = "") {
  const selected = renderCustomers(customerKey);
  renderOrders(selected);
}

function openHistoryModal() {
  const modal = document.getElementById("history-modal");
  if (!modal) return;
  modal.hidden = false;
  refreshHistory();
}

function closeHistoryModal() {
  const modal = document.getElementById("history-modal");
  if (!modal) return;
  modal.hidden = true;
}

export function initOrderHistoryUI() {
  ensureHistoryUI();

  const openBtn = document.getElementById("history-open-btn");
  const modal = document.getElementById("history-modal");
  const closeBtn = document.getElementById("history-close");
  const clearCustomerBtn = document.getElementById("history-clear-customer");
  const clearAllBtn = document.getElementById("history-clear-all");

  openBtn?.addEventListener("click", openHistoryModal);
  closeBtn?.addEventListener("click", closeHistoryModal);

  modal?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.getAttribute("data-close-history") === "1") {
      closeHistoryModal();
      return;
    }

    const customerButton = target.closest("[data-customer-key]");
    if (customerButton instanceof HTMLElement) {
      const key = customerButton.getAttribute("data-customer-key") || "";
      refreshHistory(key);
      return;
    }

    const actionButton = target.closest("[data-action]");
    if (!(actionButton instanceof HTMLElement)) return;

    const action = actionButton.getAttribute("data-action");
    const orderId = actionButton.getAttribute("data-order-id") || "";
    const customerButtons = Array.from(document.querySelectorAll(".history-customer-btn.active"));
    const activeCustomerKey = customerButtons[0]?.getAttribute("data-customer-key") || "";
    const order = getOrdersByCustomer(activeCustomerKey).find((it) => it.orderId === orderId);
    if (!order) return;

    if (action === "copy-order") {
      copyToClipboard(getMessageForOrder(order));
      return;
    }

    if (action === "resend-order") {
      openWhatsAppWithOrder(order);
    }
  });

  clearCustomerBtn?.addEventListener("click", () => {
    const active = document.querySelector(".history-customer-btn.active");
    const key = active?.getAttribute("data-customer-key") || "";
    if (!key) return;
    clearCustomerHistory(key);
    refreshHistory();
  });

  clearAllBtn?.addEventListener("click", () => {
    clearAllHistory();
    refreshHistory();
  });
}
