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

function sanitizeCode(value) {
  return toStr(value).replace(/\D/g, "");
}

function normalizeText(value) {
  return toStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizePhone(value) {
  return toStr(value).replace(/\D/g, "");
}

function samePerson(existing, incoming) {
  const existingPhone = normalizePhone(existing.telefono);
  const incomingPhone = normalizePhone(incoming.telefono);
  if (!existingPhone || existingPhone !== incomingPhone) return false;

  const sameName = normalizeText(existing.nombre) === normalizeText(incoming.nombre);
  const sameAddress =
    normalizeText(existing.direccion) &&
    normalizeText(existing.direccion) === normalizeText(incoming.direccion);

  return sameName || sameAddress;
}

function resolveDirectoryCsvUrl() {
  const directUrl = toStr(process.env.DELIVERY_DIRECTORY_CSV_URL);
  if (directUrl) return directUrl;

  const sheetId = toStr(process.env.DELIVERY_DIRECTORY_SHEET_ID) || DEFAULT_SHEET_ID;
  const gid = toStr(process.env.DELIVERY_DIRECTORY_SHEET_GID) || DEFAULT_SHEET_GID;
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((item) => item.some((value) => toStr(value)));
}

function rowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map((header) => toStr(header).toLowerCase());

  return rows.slice(1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      if (header) object[header] = row[index] ?? "";
    });
    return object;
  });
}

function normalizeClient(row) {
  const codigo = sanitizeCode(row.code ?? row.codigo ?? row.cod);
  const nombre = toStr(row.name ?? row.nombre);
  const direccion = toStr(row.address ?? row.direccion ?? row.dirección);
  const telefono = toStr(row.phone ?? row.telefono ?? row.teléfono);

  if (!CODE_REGEX.test(codigo) || !nombre || !direccion || !telefono) return null;

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

function supabaseConfig() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !secret) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel");
  }
  return { baseUrl, secret };
}

async function supabaseRequest(path, options = {}) {
  const { baseUrl, secret } = supabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: options.prefer || "return=minimal,resolution=merge-duplicates",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Supabase ${response.status}: ${text.slice(0, 700)}`);
    error.status = response.status;
    throw error;
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchTextWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/csv, text/plain, */*" },
      cache: "no-store",
      signal: controller.signal,
    });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadExistingClients() {
  const rows = await supabaseRequest(
    "clientes?select=id,codigo,nombre,direccion,telefono,activo,origen&order=id.asc",
    { method: "GET", prefer: "return=representation" },
  );
  return Array.isArray(rows) ? rows : [];
}

async function removeDuplicateRows(clients) {
  const existing = await loadExistingClients();
  let removed = 0;
  let deactivated = 0;

  for (const incoming of clients) {
    const matches = existing.filter(
      (row) => String(row.codigo) !== incoming.codigo && samePerson(row, incoming),
    );

    for (const row of matches) {
      try {
        await supabaseRequest(`clientes?id=eq.${encodeURIComponent(row.id)}`, {
          method: "DELETE",
        });
        removed += 1;
      } catch {
        await supabaseRequest(`clientes?id=eq.${encodeURIComponent(row.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ activo: false }),
        });
        deactivated += 1;
      }
    }
  }

  return { removed, deactivated };
}

async function deactivateMissingClients(activeCodes) {
  const existing = await loadExistingClients();
  let deactivated = 0;

  for (const row of existing) {
    if (row.origen !== "google_sheets") continue;
    if (activeCodes.has(String(row.codigo))) continue;
    if (row.activo === false) continue;

    await supabaseRequest(`clientes?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ activo: false }),
    });
    deactivated += 1;
  }

  return deactivated;
}

async function createSyncLog(startedAt) {
  try {
    const rows = await supabaseRequest("sincronizaciones", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        origen: "google_sheets_clientes",
        estado: "iniciada",
        started_at: startedAt,
      }),
    });
    return Array.isArray(rows) ? rows[0]?.id ?? null : null;
  } catch {
    return null;
  }
}

async function finishSyncLog(syncId, values) {
  if (!syncId) return;
  await supabaseRequest(`sincronizaciones?id=eq.${encodeURIComponent(syncId)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...values, finished_at: new Date().toISOString() }),
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
    const { response, text } = await fetchTextWithTimeout(
      resolveDirectoryCsvUrl(),
      DEFAULT_TIMEOUT_MS,
    );

    if (!response.ok) throw new Error(`Google Sheets respondió ${response.status}`);
    if (text.includes("<html") || text.includes("<!DOCTYPE html")) {
      throw new Error("La hoja de clientes no está devolviendo CSV. Revisá sus permisos.");
    }

    const rawRows = rowsToObjects(parseCsv(text));
    const normalizedRows = rawRows.map(normalizeClient);
    const invalidRows = normalizedRows.filter((client) => !client).length;
    const clientsByCode = new Map();
    let duplicateCodes = 0;

    normalizedRows.filter(Boolean).forEach((client) => {
      if (clientsByCode.has(client.codigo)) duplicateCodes += 1;
      clientsByCode.set(client.codigo, client);
    });

    const clients = [...clientsByCode.values()];
    if (!clients.length) throw new Error("No se encontraron clientes válidos en la hoja Reparto");

    await supabaseRequest("clientes?on_conflict=codigo", {
      method: "POST",
      body: JSON.stringify(clients),
    });

    const cleanup = await removeDuplicateRows(clients);
    const activeCodes = new Set(clients.map((client) => client.codigo));
    const staleDeactivated = await deactivateMissingClients(activeCodes);

    await finishSyncLog(syncId, {
      estado: "completada",
      registros_procesados: rawRows.length,
      registros_actualizados: clients.length,
      registros_con_error: invalidRows,
      mensaje: `Clientes sincronizados: ${clients.length}; duplicados eliminados: ${cleanup.removed}; inactivos: ${cleanup.deactivated + staleDeactivated}`,
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
      duplicate_codes: duplicateCodes,
      changed_code_duplicates_removed: cleanup.removed,
      duplicates_deactivated: cleanup.deactivated,
      missing_clients_deactivated: staleDeactivated,
    });
  } catch (error) {
    try {
      await finishSyncLog(syncId, {
        estado: "error",
        registros_con_error: 1,
        mensaje: String(error?.message || error).slice(0, 1000),
      });
    } catch {
      // Conservamos el error original.
    }

    return sendJson(res, 500, {
      ok: false,
      error: "No se pudieron sincronizar los clientes",
      message: String(error?.message || error),
    });
  }
}
