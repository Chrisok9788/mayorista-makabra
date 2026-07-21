// api/sync-supabase.js
export const config = { runtime: "nodejs" };

const CSV_URL =
  process.env.CSV_URL ||
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQJAgesFM5B0OTnVSvcOxrtC4VlI1ijay6erm7XnX8zjRtwUnbX-M0_4yXxRhcairW01hFOjoKQHW7t/pub?gid=1128238455&single=true&output=csv";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function toStr(value) {
  return String(value ?? "").trim();
}

function toBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = toStr(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "verdadero", "1", "si", "sí", "yes"].includes(normalized)) return true;
  if (["false", "falso", "0", "no"].includes(normalized)) return false;
  return fallback;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = toStr(value)
    .replace(/\$/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  row.push(current);
  rows.push(row);
  return rows.filter((item) => item.some((cell) => toStr(cell)));
}

function rowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(toStr);
  return rows.slice(1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      if (header) object[header] = row[index] ?? "";
    });
    return object;
  });
}

function normalizeRow(row) {
  const id = toStr(row.id);
  if (!id) return null;

  const promoMin = toNumber(row.promo_min_qty);
  const promoPrice = toNumber(row.promo_precio);

  return {
    id,
    nombre: toStr(row.nombre) || id,
    categoria: toStr(row.categoria) || "Otros",
    subcategoria: toStr(row.subcategoria) || "Otros",
    precio_base: Math.max(0, toNumber(row.precio_base)),
    oferta_carrusel: toBool(row.oferta_carrusel),
    destacados: toBool(row.Destacados ?? row.destacados),
    promo_group: toStr(row.promo_group) || null,
    promo_min_qty: promoMin > 0 ? Math.trunc(promoMin) : null,
    promo_precio: promoPrice > 0 ? promoPrice : null,
    promo_texto: toStr(row.promo_texto) || null,
    imagen_url: toStr(row.imagen_url || row.imagen) || null,
    marca: toStr(row.marca) || null,
    presentacion: toStr(row.presentacion) || null,
    tags: toStr(row.tags) || null,
    activo: toBool(row.activo, true),
    prioridad_oferta: Math.trunc(Math.max(0, toNumber(row.prioridad_oferta))),
    scanntech_id: toStr(row.scanntech_id) || null,
    barcode: toStr(row.barcode) || null,
  };
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !secret) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal,resolution=merge-duplicates",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text.slice(0, 700)}`);
  }
  return text;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const expectedToken = process.env.SYNC_TOKEN;
  const receivedToken = req.query?.token || req.headers["x-sync-token"] || "";

  if (!expectedToken) {
    return sendJson(res, 500, { error: "Falta configurar SYNC_TOKEN en Vercel" });
  }
  if (String(receivedToken) !== String(expectedToken)) {
    return sendJson(res, 401, { error: "Token de sincronización incorrecto" });
  }

  const startedAt = new Date().toISOString();
  let syncId = null;

  try {
    const syncResponse = await fetch(
      `${process.env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/sincronizaciones`,
      {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ origen: "google_sheets", estado: "iniciada", started_at: startedAt }),
      },
    );
    const syncRows = await syncResponse.json();
    if (syncResponse.ok && Array.isArray(syncRows)) syncId = syncRows[0]?.id ?? null;

    const csvResponse = await fetch(CSV_URL, { cache: "no-store" });
    const csvText = await csvResponse.text();
    if (!csvResponse.ok) throw new Error(`Google Sheets respondió ${csvResponse.status}`);
    if (csvText.includes("<html") || csvText.includes("<!DOCTYPE html")) {
      throw new Error("El enlace de Google Sheets no está devolviendo CSV");
    }

    const products = rowsToObjects(parseCSV(csvText)).map(normalizeRow).filter(Boolean);
    if (!products.length) throw new Error("No se encontraron productos válidos en la planilla");

    const batchSize = 300;
    for (let index = 0; index < products.length; index += batchSize) {
      const batch = products.slice(index, index + batchSize);
      await supabaseRequest("productos?on_conflict=id", {
        method: "POST",
        body: JSON.stringify(batch),
      });
    }

    if (syncId) {
      await supabaseRequest(`sincronizaciones?id=eq.${syncId}`, {
        method: "PATCH",
        body: JSON.stringify({
          estado: "completada",
          registros_procesados: products.length,
          registros_actualizados: products.length,
          registros_con_error: 0,
          mensaje: "Sincronización Google Sheets → Supabase completada",
          finished_at: new Date().toISOString(),
        }),
      });
    }

    return sendJson(res, 200, {
      ok: true,
      source: "google_sheets",
      destination: "supabase",
      processed: products.length,
    });
  } catch (error) {
    if (syncId) {
      try {
        await supabaseRequest(`sincronizaciones?id=eq.${syncId}`, {
          method: "PATCH",
          body: JSON.stringify({
            estado: "error",
            mensaje: String(error?.message || error).slice(0, 1000),
            finished_at: new Date().toISOString(),
          }),
        });
      } catch {
        // No ocultamos el error original si también falla el registro.
      }
    }

    return sendJson(res, 500, {
      ok: false,
      error: "No se pudo sincronizar el catálogo",
      message: String(error?.message || error),
    });
  }
}
