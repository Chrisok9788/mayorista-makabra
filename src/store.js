/**
 * @typedef {Record<string, number>} CartState
 *
 * @typedef {{
 *   search: string,
 *   category: string,
 *   subcategory: string,
 *   tags: string[],
 * }} FiltersState
 *
 * @typedef {{
 *   cart: CartState,
 *   products: Array<Record<string, any>>,
 *   filters: FiltersState,
 * }} AppState
 */

export const STORAGE_KEY = "mm_store_v2";
const LEGACY_STORE_KEY = "mm_store_v1";
const LEGACY_CART_KEY = "cart";

export const DEFAULT_STATE = {
  cart: {},
  products: [],
  filters: {
    search: "",
    category: "",
    subcategory: "",
    tags: [],
  },
};

function deepClone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

/** @param {unknown} value */
function normalizeCart(value) {
  const cart = {};

  if (!value || typeof value !== "object") return cart;

  for (const [rawId, rawQty] of Object.entries(value)) {
    const id = String(rawId ?? "").trim();
    const qty = Number(rawQty);
    if (!id || !Number.isFinite(qty) || qty < 1) continue;
    cart[id] = Math.round(qty);
  }

  return cart;
}

/** @param {any} raw */
function normalizeState(raw) {
  const base = deepClone(DEFAULT_STATE);
  if (!raw || typeof raw !== "object") return base;

  base.cart = normalizeCart(raw.cart);
  base.products = Array.isArray(raw.products) ? raw.products : [];

  if (raw.filters && typeof raw.filters === "object") {
    base.filters = {
      ...base.filters,
      ...raw.filters,
      tags: Array.isArray(raw.filters.tags) ? raw.filters.tags : [],
    };
  }

  return base;
}

function loadPersistedState() {
  if (typeof localStorage === "undefined") return deepClone(DEFAULT_STATE);

  const tryRead = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const current = tryRead(STORAGE_KEY);
  if (current) return normalizeState(current);

  const legacyStore = tryRead(LEGACY_STORE_KEY);
  const legacyCart = tryRead(LEGACY_CART_KEY);

  return normalizeState({
    ...(legacyStore || {}),
    cart: normalizeCart(legacyStore?.cart || legacyCart),
  });
}

class Store {
  /** @param {AppState} initialState */
  constructor(initialState = DEFAULT_STATE) {
    this.state = normalizeState(initialState);
    this.listeners = new Set();
    this.persistScheduled = false;
    this.lastSerializedState = "";
  }

  getState() {
    return deepClone(this.state);
  }

  getCart() {
    return deepClone(this.state.cart);
  }

  getProducts() {
    return deepClone(this.state.products);
  }

  /** @param {(state: AppState) => void} listener */
  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("[store] subscribe(listener) expects a function.");
    }

    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** @param {(state: AppState) => AppState} mutator */
  update(mutator) {
    const next = normalizeState(mutator(this.getState()));
    this.state = next;
    this.schedulePersist();
    this.emit();
  }

  /** @param {Array<Record<string, any>>} products */
  setProducts(products) {
    this.update((prev) => ({ ...prev, products: Array.isArray(products) ? products : [] }));
  }

  setCart(cart) {
    this.update((prev) => ({ ...prev, cart: normalizeCart(cart) }));
  }

  addToCart(productId, quantity = 1) {
    const id = String(productId ?? "").trim();
    const qty = Number(quantity);
    if (!id || !Number.isFinite(qty) || qty <= 0) return;

    this.update((prev) => ({
      ...prev,
      cart: {
        ...prev.cart,
        [id]: (Number(prev.cart[id]) || 0) + Math.round(qty),
      },
    }));
  }

  updateCartItemQuantity(productId, quantity) {
    const id = String(productId ?? "").trim();
    const qty = Number(quantity);
    if (!id) return;

    this.update((prev) => {
      const nextCart = { ...prev.cart };
      if (!Number.isFinite(qty) || qty <= 0) {
        delete nextCart[id];
      } else {
        nextCart[id] = Math.round(qty);
      }

      return { ...prev, cart: nextCart };
    });
  }

  removeFromCart(productId) {
    const id = String(productId ?? "").trim();
    if (!id) return;

    this.update((prev) => {
      const nextCart = { ...prev.cart };
      delete nextCart[id];
      return { ...prev, cart: nextCart };
    });
  }

  clearCart() {
    this.update((prev) => ({ ...prev, cart: {} }));
  }

  schedulePersist() {
    if (this.persistScheduled || typeof localStorage === "undefined") return;

    this.persistScheduled = true;
    queueMicrotask(() => {
      this.persistScheduled = false;
      try {
        const serialized = JSON.stringify(this.state);
        if (serialized === this.lastSerializedState) return;
        this.lastSerializedState = serialized;
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch (error) {
        console.warn("[store] Failed to persist state.", error);
      }
    });
  }

  emit() {
    const snapshot = this.getState();

    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("[store] Listener error:", error);
      }
    }
  }
}

export const store = new Store(loadPersistedState());
export { Store };
