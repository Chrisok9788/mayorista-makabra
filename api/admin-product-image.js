import crypto from "node:crypto";

export const config = { runtime: "nodejs" };

const MAX_BYTES = 2_500_000;
const MIME_TO_EXTENSION = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function toStr(value) {
  return String(value ?? "").trim();
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
  if (!expected) throw Object.assign(new Error("Panel no configurado"), { statusCode: 503 });
  if (!safeEqual(req.headers["x-admin-pin"], expected)) {
    throw Object.assign(new Error("Acceso no autorizado"), { statusCode: 401 });
  }
}

function config() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const bucket = toStr(process.env.SUPABASE_PRODUCT_IMAGES_BUCKET) || "product-images";
  if (!baseUrl || !secret) throw new Error("Supabase no está configurado");
  return { baseUrl, secret, bucket };
}

async function storageFetch(path, options = {}) {
  const { baseUrl, secret } = config();
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

async function ensureBucket(bucket) {
  const existing = await storageFetch(`bucket/${encodeURIComponent(bucket)}`, { method: "GET" });
  if (existing.ok) return;
  if (existing.status !== 404 && existing.status !== 400) {
    throw new Error(`No se pudo consultar Storage (${existing.status})`);
  }

  const created = await storageFetch("bucket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: MAX_BYTES,
      allowed_mime_types: [...MIME_TO_EXTENSION.keys()],
    }),
  });
  if (!created.ok && created.status !== 409) {
    throw new Error(`No se pudo crear el bucket de imágenes (${created.status})`);
  }
}

async function updateProductImage(productId, imageUrl) {
  const { baseUrl, secret } = config();
  const response = await fetch(
    `${baseUrl}/rest/v1/productos?id=eq.${encodeURIComponent(productId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ imagen_url: imageUrl }),
      cache: "no-store",
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`No se pudo guardar la imagen en el producto (${response.status})`);
  try {
    const rows = JSON.parse(text || "[]");
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    authorize(req);
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const productId = toStr(req.body?.product_id);
    const mimeType = toStr(req.body?.mime_type).toLowerCase();
    const dataUrl = toStr(req.body?.data_url);
    const extension = MIME_TO_EXTENSION.get(mimeType);
    if (!productId || !extension || !dataUrl.startsWith(`data:${mimeType};base64,`)) {
      return sendJson(res, 400, { ok: false, error: "INVALID_IMAGE" });
    }

    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) {
      return sendJson(res, 413, { ok: false, error: "IMAGE_TOO_LARGE", max_bytes: MAX_BYTES });
    }

    const { baseUrl, bucket } = config();
    await ensureBucket(bucket);

    const safeProduct = productId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 90) || "producto";
    const objectPath = `${safeProduct}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const uploaded = await storageFetch(
      `object/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,
      {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          "x-upsert": "false",
          "Cache-Control": "3600",
        },
        body: bytes,
      },
    );
    if (!uploaded.ok) {
      const message = (await uploaded.text()).slice(0, 400);
      throw new Error(`Storage rechazó la imagen (${uploaded.status}): ${message}`);
    }

    const publicUrl = `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const product = await updateProductImage(productId, publicUrl);

    return sendJson(res, 200, { ok: true, image_url: publicUrl, product });
  } catch (error) {
    console.error("[admin-product-image]", error?.message || error);
    return sendJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.statusCode === 401 ? "UNAUTHORIZED" : "IMAGE_UPLOAD_ERROR",
      message: error?.statusCode && error.statusCode < 500 ? error.message : "No se pudo subir la imagen",
    });
  }
}
