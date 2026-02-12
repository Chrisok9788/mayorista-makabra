const STORAGE_KEY = 'mm_store_v1';

const DEFAULT_STATE = {
  cart: [],
  products: [],
  filters: {
    search: '',
    category: '',
    subcategory: '',
    tags: [],
  },
};

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepClone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function mergeState(base, patch) {
  const output = deepClone(base);

  if (Array.isArray(patch?.cart)) output.cart = patch.cart;
  if (Array.isArray(patch?.products)) output.products = patch.products;
  if (isObject(patch?.filters)) output.filters = { ...output.filters, ...patch.filters };

  return output;
}

function loadPersistedState() {
  if (typeof localStorage === 'undefined') return deepClone(DEFAULT_STATE);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(DEFAULT_STATE);

    const parsed = JSON.parse(raw);
    return mergeState(DEFAULT_STATE, parsed);
  } catch (error) {
    console.warn('[store] Persisted state is invalid, using default state.', error);
    return deepClone(DEFAULT_STATE);
  }
}

class Store {
  constructor(initialState = DEFAULT_STATE) {
    this.state = mergeState(DEFAULT_STATE, initialState);
    this.listeners = new Set();
  }

  getState() {
    return deepClone(this.state);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('[store] subscribe(listener) expects a function.');
    }

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  setState(partialState) {
    const next = mergeState(this.state, partialState);
    this.state = next;
    this.persist();
    this.emit();
  }

  setProducts(products) {
    this.setState({ products: Array.isArray(products) ? products : [] });
  }

  setFilters(filters) {
    this.setState({ filters: isObject(filters) ? filters : {} });
  }

  resetFilters() {
    this.setState({ filters: deepClone(DEFAULT_STATE.filters) });
  }

  addToCart(product, quantity = 1) {
    if (!product || !product.id) return;

    const normalizedQty = Number(quantity);
    if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) return;

    const cart = this.state.cart.map((item) => ({ ...item }));
    const index = cart.findIndex((item) => item.id === product.id);

    if (index >= 0) {
      cart[index].quantity += normalizedQty;
    } else {
      cart.push({
        id: product.id,
        name: product.name ?? product.nombre ?? '',
        price: Number(product.price ?? product.precio ?? 0) || 0,
        quantity: normalizedQty,
      });
    }

    this.setState({ cart });
  }

  updateCartItemQuantity(productId, quantity) {
    const normalizedQty = Number(quantity);
    if (!productId) return;

    if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
      this.removeFromCart(productId);
      return;
    }

    const cart = this.state.cart.map((item) =>
      item.id === productId ? { ...item, quantity: normalizedQty } : item,
    );

    this.setState({ cart });
  }

  removeFromCart(productId) {
    if (!productId) return;
    this.setState({ cart: this.state.cart.filter((item) => item.id !== productId) });
  }

  clearCart() {
    this.setState({ cart: [] });
  }

  persist() {
    if (typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (error) {
      console.warn('[store] Failed to persist state.', error);
    }
  }

  emit() {
    const snapshot = this.getState();

    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[store] Listener error:', error);
      }
    }
  }
}

export const store = new Store(loadPersistedState());
export { Store, STORAGE_KEY, DEFAULT_STATE };
