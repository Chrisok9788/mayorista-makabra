// data.js — carga catálogo desde /api/catalog con cache local
// ✅ Cache local (último catálogo bueno)
// ✅ Actualización en background

const API_BASE =
  (typeof window !== "undefined" && window.CATALOG_API_BASE) ||
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ||
  "";
const API_ENDPOINT = `${API_BASE}/api/catalog`.replace(/([^:]\/)\/+/g, "$1");
const CACHE_KEY = "catalog-cache-v2";
const CACHE_VERSION = 2;
const DEFAULT_TIMEOUT_MS = 10000;

/* =========================
   Helpers defensivos
   ========================= */

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hashString(input) {
  let hash = 0;
  const s = String(input ?? "");
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function readCache() {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  if (!parsed || parsed.version !== CACHE_VERSION || !Array.isArray(parsed.products)) {
    return null;
  }
  return parsed;
}

function writeCache(products) {
  if (typeof localStorage === "undefined") return null;
  const payload = {
    version: CACHE_VERSION,
    lastUpdated: Date.now(),
    hash: hashString(JSON.stringify(products)),
    products,
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  return payload;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProductsRemote(timeoutMs = DEFAULT_TIMEOUT_MS) {
  let res;
  let data;
  try {
    const url = API_ENDPOINT.includes("?")
      ? `${API_ENDPOINT}&_ts=${Date.now()}`
      : `${API_ENDPOINT}?_ts=${Date.now()}`;

    ({ res, data } = await fetchJsonWithTimeout(url, timeoutMs));
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Timeout al actualizar el catálogo.");
    }
    throw new Error("No se pudo conectar para actualizar el catálogo.");
  }

  if (!res?.ok) {
    const msg = data?.error ? `: ${data.error}` : "";
    throw new Error(`Error HTTP ${res?.status ?? "?"} al cargar catálogo${msg}`);
  }

  const products = data?.products;
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error("No llegaron productos desde /api/catalog.");
  }

  return products;
}

export async function loadProductsWithCache({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cached = readCache();

  const updatePromise = fetchProductsRemote(timeoutMs)
    .then((products) => {
      const hash = hashString(JSON.stringify(products));
      const isSame = cached?.hash === hash;
      const payload = isSame ? cached : writeCache(products);
      return {
        products,
        fromCache: false,
        lastUpdated: payload?.lastUpdated ?? Date.now(),
        changed: !isSame,
      };
    })
    .catch((error) => ({ error }));

  if (cached?.products?.length) {
    return {
      products: cached.products,
      fromCache: true,
      lastUpdated: cached.lastUpdated,
      updatePromise,
    };
  }

  const result = await updatePromise;
  if (result?.error) throw result.error;
  return {
    products: result.products,
    fromCache: false,
    lastUpdated: result.lastUpdated,
    updatePromise: Promise.resolve(result),
  };
}
