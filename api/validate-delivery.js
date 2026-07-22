const CODE_REGEX = /^\d{5}$/;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_SHEET_ID = "1w3lSeXgTnbxvUIzUiWm9eGlQ4ln7DAEXB9KMaYal9Wo";
const DEFAULT_SHEET_GID = "1075478535";

function sanitizeCode(input) {
  return String(input ?? "").replace(/\D/g, "").trim();
}

function getLast3(code) {
  const value = String(code || "");
  return value.slice(-3);
}

function toStr(value) {
  return String(value ?? "").trim();
}

function resolveDirectoryCsvUrl() {
  const directUrl = toStr(process.env.DELIVERY_DIRECTORY_CSV_URL);
  if (directUrl) return directUrl;

  const sheetId = toStr(process.env.DELIVERY_DIRECTORY_SHEET_ID) || DEFAULT_SHEET_ID;
  const gid = toStr(process.env.DELIVERY_DIRECTORY_SHEET_GID) || DEFAULT_SHEET_GID;

  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=csv&gid=${encodeURIComponent(gid)}`;
}

function readDirectoryFromEnv() {
  const raw = process.env.DELIVERY_DIRECTORY_JSON;
  if (!raw) {
    throw new Error("MISSING_DIRECTORY");
  }

  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("INVALID_DIRECTORY_FORMAT");
  }

  return parsed;
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

function mapRowToProfile(row) {
  return {
    code: sanitizeCode(row.code ?? row.codigo ?? row.cod),
    name: toStr(row.name ?? row.nombre),
    address: toStr(row.address ?? row.direccion ?? row.dirección),
    phone: toStr(row.phone ?? row.telefono ?? row.teléfono),
  };
}

function sanitizeProfile(entry) {
  if (!entry || typeof entry !== "object") return null;

  const profile = {
    code: sanitizeCode(entry.code ?? entry.codigo),
    name: toStr(entry.name ?? entry.nombre),
    address: toStr(entry.address ?? entry.direccion),
    phone: toStr(entry.phone ?? entry.telefono),
  };

  if (
    !CODE_REGEX.test(profile.code) ||
    !profile.name ||
    !profile.address ||
    !profile.phone
  ) {
    return null;
  }

  return profile;
}

async function readProfileFromSupabase(code) {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!baseUrl || !secret) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }

  const params = new URLSearchParams({
    select: "codigo,nombre,direccion,telefono",
    codigo: `eq.${code}`,
    activo: "eq.true",
    limit: "1",
  });

  const response = await fetch(`${baseUrl}/rest/v1/clientes?${params.toString()}`, {
    method: "GET",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SUPABASE_${response.status}:${text.slice(0, 300)}`);
  }

  const rows = JSON.parse(text || "[]");
  if (!Array.isArray(rows) || !rows.length) return null;

  return sanitizeProfile(rows[0]);
}

async function readDirectoryFromSheets() {
  const csvUrl = resolveDirectoryCsvUrl();
  const { response, text } = await fetchTextWithTimeout(csvUrl, DEFAULT_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`DIRECTORY_HTTP_${response.status}`);
  }

  if (text.includes("<html") || text.includes("<!DOCTYPE html")) {
    throw new Error("DIRECTORY_NOT_CSV");
  }

  const rows = mapRowsToObjects(parseCsv(text));
  return rows.map(mapRowToProfile).filter(Boolean);
}

async function readDirectoryFallback() {
  try {
    return await readDirectoryFromSheets();
  } catch {
    return readDirectoryFromEnv();
  }
}

async function findProfile(code) {
  try {
    const profile = await readProfileFromSupabase(code);
    if (profile) {
      return { profile, source: "supabase" };
    }
  } catch (error) {
    console.warn(
      "[delivery] Supabase fallback for ***" + getLast3(code),
      String(error?.message || error).slice(0, 120),
    );
  }

  const directory = await readDirectoryFallback();
  const match = directory.find((entry) => sanitizeCode(entry?.code ?? entry?.codigo) === code);
  const profile = sanitizeProfile(match);

  return profile ? { profile, source: "google_sheets" } : null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ valid: false, error: "METHOD_NOT_ALLOWED" });
  }

  let code = "";

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    code = sanitizeCode(body?.code);
  } catch {
    return res.status(400).json({ valid: false, error: "BAD_REQUEST" });
  }

  if (!CODE_REGEX.test(code)) {
    return res.status(400).json({ valid: false, error: "BAD_REQUEST" });
  }

  try {
    const result = await findProfile(code);

    if (!result?.profile) {
      return res.status(404).json({ valid: false, error: "NOT_FOUND" });
    }

    return res.status(200).json({
      valid: true,
      profile: result.profile,
      source: result.source,
    });
  } catch (error) {
    console.error(
      "[delivery] validation failed for ***" + getLast3(code),
      String(error?.message || error).slice(0, 200),
    );
    return res.status(500).json({ valid: false, error: "INTERNAL_ERROR" });
  }
}
