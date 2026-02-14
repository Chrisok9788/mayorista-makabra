const STORAGE_KEY = "mmw:orders:v1";
const MAX_PER_CUSTOMER = 50;
const MAX_TOTAL = 500;

function isoNow() {
  return new Date().toISOString();
}

function createEmptyStore() {
  return {
    customers: {},
    updatedAt: isoNow(),
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOrder(order) {
  if (!isObject(order)) return null;

  const customerKey = String(order.customerKey || "").trim();
  if (!customerKey) return null;

  const items = Array.isArray(order.items)
    ? order.items
        .map((item) => ({
          name: String(item?.name || "").trim(),
          qty: Number(item?.qty) || 0,
          unitPriceRounded: Number(item?.unitPriceRounded) || 0,
          subtotalRounded: Number(item?.subtotalRounded) || 0,
        }))
        .filter((item) => item.name && item.qty > 0)
    : [];

  return {
    orderId: String(order.orderId || "").trim() || `MK-${Date.now().toString(36).toUpperCase()}`,
    createdAt: String(order.createdAt || "").trim() || isoNow(),
    customerKey,
    customerLabel: String(order.customerLabel || customerKey).trim(),
    items,
    totalRounded: Number(order.totalRounded) || 0,
    hasConsultables: Boolean(order.hasConsultables),
    messagePreview: String(order.messagePreview || "").slice(0, 300),
    messageText: String(order.messageText || ""),
  };
}

function parseStore(raw) {
  if (!raw) return createEmptyStore();

  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !isObject(parsed.customers)) return createEmptyStore();

    const customers = {};
    for (const [key, orders] of Object.entries(parsed.customers)) {
      if (!Array.isArray(orders)) continue;
      const safeKey = String(key || "").trim();
      if (!safeKey) continue;
      customers[safeKey] = orders
        .map(normalizeOrder)
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, MAX_PER_CUSTOMER);
    }

    return {
      customers,
      updatedAt: String(parsed.updatedAt || "").trim() || isoNow(),
    };
  } catch {
    return createEmptyStore();
  }
}

function readStore() {
  try {
    return parseStore(localStorage.getItem(STORAGE_KEY));
  } catch {
    return createEmptyStore();
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

function enforceLimits(store) {
  for (const key of Object.keys(store.customers)) {
    store.customers[key] = (store.customers[key] || [])
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, MAX_PER_CUSTOMER);

    if (!store.customers[key].length) {
      delete store.customers[key];
    }
  }

  let allOrders = Object.entries(store.customers).flatMap(([key, orders]) =>
    orders.map((order) => ({ key, order }))
  );

  if (allOrders.length <= MAX_TOTAL) return store;

  allOrders = allOrders.sort((a, b) => String(b.order.createdAt).localeCompare(String(a.order.createdAt)));
  const allowed = new Set(allOrders.slice(0, MAX_TOTAL).map((entry) => entry.order.orderId));

  for (const key of Object.keys(store.customers)) {
    store.customers[key] = (store.customers[key] || []).filter((order) => allowed.has(order.orderId));
    if (!store.customers[key].length) {
      delete store.customers[key];
    }
  }

  return store;
}

export function addOrderToHistory(order) {
  try {
    const safeOrder = normalizeOrder(order);
    if (!safeOrder) return false;

    const store = readStore();
    if (!Array.isArray(store.customers[safeOrder.customerKey])) {
      store.customers[safeOrder.customerKey] = [];
    }

    store.customers[safeOrder.customerKey].unshift(safeOrder);
    enforceLimits(store);
    store.updatedAt = isoNow();
    return writeStore(store);
  } catch {
    return false;
  }
}

export function getCustomers() {
  try {
    const store = readStore();
    return Object.entries(store.customers)
      .map(([key, orders]) => ({
        key,
        label: orders?.[0]?.customerLabel || key,
        totalOrders: Array.isArray(orders) ? orders.length : 0,
        lastOrderAt: orders?.[0]?.createdAt || "",
      }))
      .sort((a, b) => String(b.lastOrderAt).localeCompare(String(a.lastOrderAt)));
  } catch {
    return [];
  }
}

export function getOrdersByCustomer(key) {
  try {
    const customerKey = String(key || "").trim();
    if (!customerKey) return [];
    const store = readStore();
    return Array.isArray(store.customers[customerKey]) ? [...store.customers[customerKey]] : [];
  } catch {
    return [];
  }
}

export function clearCustomerHistory(key) {
  try {
    const customerKey = String(key || "").trim();
    if (!customerKey) return false;
    const store = readStore();
    delete store.customers[customerKey];
    store.updatedAt = isoNow();
    return writeStore(store);
  } catch {
    return false;
  }
}

export function clearAllHistory() {
  try {
    const store = createEmptyStore();
    return writeStore(store);
  } catch {
    return false;
  }
}
