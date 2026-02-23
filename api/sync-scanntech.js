// api/sync-scanntech.js
export const config = { runtime: "nodejs" };

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function fetchJsonWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: controller.signal });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    return { ok: r.ok, status: r.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  // Solo GET o POST (para poder dispararlo manual o por cron)
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method Not Allowed" });
  }

  // Seguridad: token obligatorio
  const expected = process.env.SYNC_TOKEN;
  const token =
    (req.query && req.query.token) ||
    req.headers["x-sync-token"] ||
    "";

  if (!expected) {
    return json(res, 500, { error: "Missing SYNC_TOKEN env var in Vercel" });
  }
  if (String(token) !== String(expected)) {
    return json(res, 401, { error: "Unauthorized (bad token)" });
  }

  // Config Scanntech (todo por env vars, nunca hardcode)
  const baseUrl = process.env.SCANNTECH_BASE_URL; // ej: https://api.scanntech.com.uy (ejemplo)
  const apiKey = process.env.SCANNTECH_API_KEY;   // bearer o la key que te den
  const productsPath = process.env.SCANNTECH_PRODUCTS_PATH || "/products";
  const timeoutMs = Number(process.env.SCANNTECH_TIMEOUT_MS || 12000);

  if (!baseUrl || !apiKey) {
    return json(res, 500, {
      error: "Missing SCANNTECH_BASE_URL or SCANNTECH_API_KEY env vars in Vercel",
    });
  }

  // Modo seguro: por defecto NO escribe nada. Solo preview.
  // Para forzar “modo real” más adelante: ?dry=0
  const dry = String((req.query && req.query.dry) ?? "1") !== "0";
  const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 20)));

  const url = `${baseUrl.replace(/\/$/, "")}${productsPath}`;

  try {
    const result = await fetchJsonWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      },
      timeoutMs
    );

    if (!result.ok) {
      return json(res, 502, {
        error: "Scanntech request failed",
        status: result.status,
        // ojo: no exponemos apiKey, pero sí un snippet de error
        snippet: (result.text || "").slice(0, 500),
      });
    }

    // Scanntech puede devolver array o {data:[]}
    const raw = result.data;
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];

    // Preview “limpio” (no mandamos 2000 items al celu)
    const sample = list.slice(0, limit).map((p) => ({
      id: p.id ?? p.codigo ?? p.sku ?? null,
      nombre: p.nombre ?? p.name ?? null,
      precio_base: p.precio_base ?? p.price ?? null,
      promociones: p.promociones ?? p.promotions ?? null,
      stock: p.stock ?? p.inventory ?? null,
    }));

    // TODO (próximo paso): si dry=false => escribir en Sheets
    // Por ahora, dejamos esto preparado.
    return json(res, 200, {
      ok: true,
      dryRun: dry,
      fetched: list.length,
      sample,
      nextStep:
        "Cuando confirmes que el endpoint de Scanntech es correcto, implementamos escritura en Google Sheets (service account) y cron.",
    });
  } catch (e) {
    return json(res, 500, { error: "Sync crashed", message: String(e?.message || e) });
  }
}
