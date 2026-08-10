import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

const PAGE_SIZE = 1000;
const MAX_IMAGE_BYTES = 2_500_000;
const IMAGE_MIME_TO_EXTENSION = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const PRODUCT_FIELDS = [
  "id",
  "nombre",
  "categoria",
  "subcategoria",
  "precio_base",
  "oferta_carrusel",
  "destacados",
  "promo_group",
  "promo_min_qty",
  "promo_precio",
  "promo_texto",
  "imagen_url",
  "marca",
  "presentacion",
  "tags",
  "activo",
  "prioridad_oferta",
  "scanntech_id",
  "barcode",
].join(",");

function toStr(value) {
  return String(value ?? "").trim();
}

function toBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = toStr(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "si", "sí", "yes", "verdadero"].includes(normalized)) return true;
  if (["false", "0", "no", "falso"].includes(normalized)) return false;
  return fallback;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

function safeEqual(received, expected) {
  const a = Buffer.from(toStr(received));
  const b = Buffer.from(toStr(expected));
  return Boolean(a.length && a.length === b.length && crypto.timingSafeEqual(a, b));
}

function authorize(req) {
  const expected = toStr(process.env.ADMIN_PANEL_PIN || process.env.ORDERS_PANEL_PIN);
  if (!expected) {
    const error = new Error("Falta configurar ADMIN_PANEL_PIN u ORDERS_PANEL_PIN en Vercel");
    error.statusCode = 503;
    error.code = "ADMIN_PIN_NOT_CONFIGURED";
    throw error;
  }
  if (!safeEqual(req.headers["x-admin-pin"], expected)) {
    const error = new Error("Acceso no autorizado");
    error.statusCode = 401;
    error.code = "UNAUTHORIZED";
    throw error;
  }
}

function supabaseConfig() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !secret) throw new Error("Supabase no está configurado");
  return { baseUrl, secret };
}

async function supabaseRequest(path, options = {}) {
  const { baseUrl, secret } = supabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Supabase respondió ${response.status}`);
    error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
    error.detail = text.slice(0, 600);
    throw error;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function storageRequest(path, options = {}) {
  const { baseUrl, secret } = supabaseConfig();
  return fetch(`${baseUrl}/storage/v1/${path}`, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
}

async function ensureImageBucket(bucket) {
  const existing = await storageRequest(`bucket/${encodeURIComponent(bucket)}`, { method: "GET" });
  if (existing.ok) return;
  if (existing.status !== 404 && existing.status !== 400) {
    throw new Error(`No se pudo consultar Storage (${existing.status})`);
  }

  const created = await storageRequest("bucket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: MAX_IMAGE_BYTES,
      allowed_mime_types: [...IMAGE_MIME_TO_EXTENSION.keys()],
    }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`No se pudo crear el bucket de imágenes (${created.status})`);
  }
}

async function loadAllProducts() {
  const products = [];
  let offset = 0;
  while (true) {
    const rows = await supabaseRequest(
      `productos?select=${PRODUCT_FIELDS}&order=prioridad_oferta.desc,nombre.asc&limit=${PAGE_SIZE}&offset=${offset}`,
      { method: "GET", headers: { Prefer: "return=representation" } },
    );
    const batch = Array.isArray(rows) ? rows : [];
    products.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset > 10000) break;
  }
  return products;
}

function slugify(value) {
  return toStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeProduct(input, { partial = false } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const result = {};
  const copyString = (key, max = 500, nullable = false) => {
    if (partial && !(key in body)) return;
    const value = toStr(body[key]).slice(0, max);
    result[key] = nullable && !value ? null : value;
  };
  const copyBool = (key, fallback = false) => {
    if (partial && !(key in body)) return;
    result[key] = toBool(body[key], fallback);
  };
  const copyNumber = (key, { min = 0, integer = false, nullable = false } = {}) => {
    if (partial && !(key in body)) return;
    const raw = body[key];
    if (nullable && (raw === null || raw === undefined || toStr(raw) === "")) {
      result[key] = null;
      return;
    }
    let value = Math.max(min, toNumber(raw, 0));
    if (integer) value = Math.trunc(value);
    result[key] = value;
  };

  copyString("nombre", 300);
  copyString("categoria", 160);
  copyString("subcategoria", 160);
  copyNumber("precio_base", { min: 0 });
  copyBool("oferta_carrusel");
  copyBool("destacados");
  copyString("promo_group", 120, true);
  copyNumber("promo_min_qty", { min: 0, integer: true, nullable: true });
  copyNumber("promo_precio", { min: 0, nullable: true });
  copyString("promo_texto", 300, true);
  copyString("imagen_url", 1200, true);
  copyString("marca", 160, true);
  copyString("presentacion", 160, true);
  copyString("tags", 1000, true);
  copyBool("activo", true);
  copyNumber("prioridad_oferta", { min: 0, integer: true });
  copyString("scanntech_id", 160, true);
  copyString("barcode", 40, true);

  if (!partial) {
    if (!result.nombre) throw Object.assign(new Error("El nombre es obligatorio"), { statusCode: 400 });
    if (!result.categoria) result.categoria = "Otros";
    if (!result.subcategoria) result.subcategoria = "Otros";
  }

  return result;
}

async function assertUniqueExternalIds(productId, values) {
  for (const field of ["barcode", "scanntech_id"]) {
    const value = toStr(values[field]);
    if (!value) continue;
    const rows = await supabaseRequest(
      `productos?select=id,nombre,${field}&${field}=eq.${encodeURIComponent(value)}&limit=2`,
      { method: "GET", headers: { Prefer: "return=representation" } },
    );
    const conflict = (Array.isArray(rows) ? rows : []).find((row) => toStr(row.id) !== toStr(productId));
    if (conflict) {
      const error = new Error(`${field === "barcode" ? "Código de barras" : "ID Scanntech"} ya está asignado a ${conflict.nombre || conflict.id}`);
      error.statusCode = 409;
      error.code = "DUPLICATE_EXTERNAL_ID";
      throw error;
    }
  }
}

async function handleList(res) {
  const products = await loadAllProducts();
  const categories = new Map();
  let active = 0;
  let withoutImage = 0;
  let carousel = 0;

  for (const product of products) {
    if (product.activo) active += 1;
    if (!toStr(product.imagen_url)) withoutImage += 1;
    if (product.oferta_carrusel) carousel += 1;
    const category = toStr(product.categoria) || "Otros";
    const subcategory = toStr(product.subcategoria) || "Otros";
    if (!categories.has(category)) categories.set(category, new Set());
    categories.get(category).add(subcategory);
  }

  return sendJson(res, 200, {
    ok: true,
    source: "supabase",
    google_sheets_fallback: true,
    products,
    stats: {
      total: products.length,
      active,
      inactive: products.length - active,
      without_image: withoutImage,
      carousel,
    },
    taxonomy: [...categories.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "es"))
      .map(([categoria, subcategories]) => ({
        categoria,
        subcategorias: [...subcategories].sort((a, b) => a.localeCompare(b, "es")),
      })),
  });
}

async function handleCreate(req, res) {
  const product = normalizeProduct(req.body);
  const requestedId = toStr(req.body?.id);
  const id = requestedId || `${slugify(product.nombre) || "producto"}-${Date.now().toString(36)}`;
  await assertUniqueExternalIds(id, product);

  const rows = await supabaseRequest("productos", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ id, ...product }),
  });
  return sendJson(res, 201, { ok: true, product: Array.isArray(rows) ? rows[0] : { id, ...product } });
}

async function handlePatch(req, res) {
  const id = toStr(req.body?.id);
  if (!id) return sendJson(res, 400, { ok: false, error: "MISSING_ID" });
  const changes = normalizeProduct(req.body?.changes || {}, { partial: true });
  delete changes.id;
  if (!Object.keys(changes).length) return sendJson(res, 400, { ok: false, error: "NO_CHANGES" });
  await assertUniqueExternalIds(id, changes);

  const rows = await supabaseRequest(`productos?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(changes),
  });
  if (!Array.isArray(rows) || !rows.length) return sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  return sendJson(res, 200, { ok: true, product: rows[0] });
}

async function handleDeactivate(req, res) {
  const id = toStr(req.body?.id);
  if (!id) return sendJson(res, 400, { ok: false, error: "MISSING_ID" });
  const rows = await supabaseRequest(`productos?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ activo: false, oferta_carrusel: false }),
  });
  if (!Array.isArray(rows) || !rows.length) return sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  return sendJson(res, 200, { ok: true, product: rows[0] });
}

async function handleTaxonomy(req, res) {
  const oldCategory = toStr(req.body?.old_category);
  const newCategory = toStr(req.body?.new_category);
  const oldSubcategory = toStr(req.body?.old_subcategory);
  const newSubcategory = toStr(req.body?.new_subcategory);
  if (!oldCategory) return sendJson(res, 400, { ok: false, error: "OLD_CATEGORY_REQUIRED" });

  const filters = [`categoria=eq.${encodeURIComponent(oldCategory)}`];
  const changes = {};
  if (newCategory) changes.categoria = newCategory;
  if (oldSubcategory) {
    filters.push(`subcategoria=eq.${encodeURIComponent(oldSubcategory)}`);
    if (!newSubcategory) return sendJson(res, 400, { ok: false, error: "NEW_SUBCATEGORY_REQUIRED" });
    changes.subcategoria = newSubcategory;
  }
  if (!Object.keys(changes).length) return sendJson(res, 400, { ok: false, error: "NO_CHANGES" });

  const rows = await supabaseRequest(`productos?${filters.join("&")}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(changes),
  });
  return sendJson(res, 200, { ok: true, updated: Array.isArray(rows) ? rows.length : 0 });
}

async function handleImageUpload(req, res) {
  const productId = toStr(req.body?.product_id);
  const mimeType = toStr(req.body?.mime_type).toLowerCase();
  const dataUrl = toStr(req.body?.data_url);
  const extension = IMAGE_MIME_TO_EXTENSION.get(mimeType);

  if (!productId || !extension || !dataUrl.startsWith(`data:${mimeType};base64,`)) {
    return sendJson(res, 400, { ok: false, error: "INVALID_IMAGE" });
  }

  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    return sendJson(res, 413, { ok: false, error: "IMAGE_TOO_LARGE", max_bytes: MAX_IMAGE_BYTES });
  }

  const { baseUrl } = supabaseConfig();
  const bucket = toStr(process.env.SUPABASE_PRODUCT_IMAGES_BUCKET) || "product-images";
  await ensureImageBucket(bucket);

  const safeProduct = productId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 90) || "producto";
  const objectPath = `${safeProduct}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  const uploaded = await storageRequest(`object/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "x-upsert": "false",
      "Cache-Control": "3600",
    },
    body: bytes,
  });

  if (!uploaded.ok) {
    const detail = (await uploaded.text()).slice(0, 400);
    const error = new Error(`Storage rechazó la imagen (${uploaded.status})`);
    error.detail = detail;
    throw error;
  }

  const publicUrl = `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
  const rows = await supabaseRequest(`productos?id=eq.${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ imagen_url: publicUrl }),
  });
  if (!Array.isArray(rows) || !rows.length) return sendJson(res, 404, { ok: false, error: "NOT_FOUND" });

  return sendJson(res, 200, { ok: true, image_url: publicUrl, product: rows[0] });
}

export default async function handler(req, res) {
  try {
    authorize(req);
    if (req.method === "GET") return handleList(res);
    if (req.method === "POST") {
      if (toStr(req.query?.route) === "image" || req.body?.action === "upload_image") {
        return handleImageUpload(req, res);
      }
      if (req.body?.action === "rename_taxonomy") return handleTaxonomy(req, res);
      return handleCreate(req, res);
    }
    if (req.method === "PATCH") return handlePatch(req, res);
    if (req.method === "DELETE") return handleDeactivate(req, res);
    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    console.error("[admin-products]", error?.code || error?.message || error, error?.detail || "");
    return sendJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.code || "ADMIN_PRODUCTS_ERROR",
      message: error?.statusCode && error.statusCode < 500 ? error.message : "No se pudo completar la operación",
    });
  }
}
