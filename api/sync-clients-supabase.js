export const config = { runtime: "nodejs" };

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_SHEET_ID = "1w3lSeXgTnbxvUIzUiWm9eGlQ4ln7DAEXB9KMaYal9Wo";
const DEFAULT_SHEET_GID = "1075478535";
const CODE_REGEX = /^\d{7}$/;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function toStr(value) {
  return String(value ?? "").trim();
}

function sanitizeCode(input) {
  return toStr(input).replace(/\D/g, "");
}

function resolveDirectoryCsvUrl() {
  const directUrl = toStr(process.env.DELIVERY_DIRECTORY_CSV_URL);
  if (directUrl) return directUrl;

  const sheetId = toStr(process.env.DELIVERY_DIRECTORY_SHEET_ID) || DEFAULT_SHEET_ID;
  const gid = toStr(process.env.DELIVERY_DIRECTORY_SHEET_GID) || DEFAULT_SHEET_GID;

  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

function parseCsv(csvText) {
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const next = csvText[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      currentCell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);
  return rows.filter((row) => row.some((cell) => toStr(cell)));
}

function mapRowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const headers = rows[0].map((header) => toStr(header).toLowerCase());
  return rows.slice(1).map((row) => {
    const result = {};
    headers.forEach((header, index) => {
      if (header) result[header] = row[index] ?? "";
    });
    return result;
  });
}

function normalizeClient(row) {
  const codigo = sanitizeCode(row.code ?? row.codigo ?? row.cod);
  const nombre = toStr(row.name ?? row.nombre);
  const direccion = toStr(row.address ?? row.direccion ?? row.dirección);
  const telefono = toStr(row.phone ?? row.telefono ?? row.teléfono);

  if (!CODE_REGEX.test(codigo) || !nombre || !direccion || !telefono) {
    return null;
  }

  return {
    codigo,
    nombre,
    direccion,
    telefono,
    tipo: "reparto",
    activo: true,
    origen: "google_sheets",
  };
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/csv, text/plain, */*" },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function supabaseRequest(path, options = {}) {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!baseUrl || !secret) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel");
  }

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
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

async function createSyncLog(startedAt) {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !secret) return null;

  const response = await fetch(`${baseUrl}/rest/v1/sincronizaciones`, {
    method: "POST",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      origen: "google_sheets_clientes",
      estado: "iniciada",
      started_at: startedAt,
    }),
  });

  if (!response.ok) return null;
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0]?.id ?? null : null;
}

async function finishSyncLog(syncId, values) {
  if (!syncId) return;
  await supabaseRequest(`sincronizaciones?id=eq.${syncId}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...values,
      finished_at: new Date().toISOString(),
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const expectedToken = toStr(process.env.SYNC_TOKEN);
  const receivedToken = toStr(req.query?.token || req.headers["x-sync-token"]);

  if (!expectedToken) {
    return sendJson(res, 500, { ok: false, error: "Falta configurar SYNC_TOKEN en Vercel" });
  }

  if (receivedToken !== expectedToken) {
    return sendJson(res, 401, { ok: false, error: "Token de sincronización incorrecto" });
  }

  const startedAt = new Date().toISOString();
  let syncId = null;

  try {
    syncId = await createSyncLog(startedAt);

    const csvUrl = resolveDirectoryCsvUrl();
    const { response, text } = await fetchTextWithTimeout(csvUrl, DEFAULT_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(`Google Sheets respondió ${response.status}`);
    }

    if (text.includes("<html") || text.includes("<!DOCTYPE html")) {
      throw new Error("La hoja de clientes no está devolviendo CSV. Revisá sus permisos de acceso.");
    }

    const rawRows = mapRowsToObjects(parseCsv(text));
    const normalizedRows = rawRows.map(normalizeClient);
    const invalidRows = normalizedRows.filter((client) => !client).length;

    const clientsByCode = new Map();
    let duplicates = 0;

    normalizedRows.filter(Boolean).forEach((client) => {
      if (clientsByCode.has(client.codigo)) duplicates += 1;
      clientsByCode.set(client.codigo, client);
    });

    const clients = Array.from(clientsByCode.values());
    if (!clients.length) {
      throw new Error("No se encontraron clientes válidos en la hoja Reparto");
    }

    await supabaseRequest("clientes?on_conflict=codigo", {
      method: "POST",
      body: JSON.stringify(clients),
    });

    await finishSyncLog(syncId, {
      estado: "completada",
      registros_procesados: rawRows.length,
      registros_actualizados: clients.length,
      registros_con_error: invalidRows,
      mensaje: `Clientes Google Sheets → Supabase: ${clients.length} actualizados`,
    });

    return sendJson(res, 200, {
      ok: true,
      source: "google_sheets",
      destination: "supabase",
      sheet_id: DEFAULT_SHEET_ID,
      sheet_gid: DEFAULT_SHEET_GID,
      rows_read: rawRows.length,
      clients_synced: clients.length,
      invalid_rows: invalidRows,
      duplicate_codes: duplicates,
    });
  } catch (error) {
    try {
      await finishSyncLog(syncId, {
        estado: "error",
        registros_con_error: 1,
        mensaje: String(error?.message || error).slice(0, 1000),
      });
    } catch {
      // Conservamos el error original aunque también falle el registro de sincronización.
    }

    return sendJson(res, 500, {
      ok: false,
      error: "No se pudieron sincronizar los clientes",
      message: String(error?.message || error),
    });
  }
}
