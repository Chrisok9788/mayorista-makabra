import crypto from "node:crypto";

const CODE_REGEX = /^\d{5}$/;
const TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function toStr(value) {
  return String(value ?? "").trim();
}

function toBool(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getServiceAccountConfig() {
  const fromJson = toStr(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (fromJson) {
    try {
      const parsed = JSON.parse(fromJson);
      return {
        email: toStr(parsed.client_email),
        privateKey: String(parsed.private_key || "").replace(/\\n/g, "\n"),
      };
    } catch {
      return { email: "", privateKey: "" };
    }
  }

  return {
    email: toStr(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    privateKey: String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}

async function getAccessToken() {
  const { email, privateKey } = getServiceAccountConfig();
  if (!email || !privateKey) {
    throw new Error("MISSING_SERVICE_ACCOUNT");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });

  const tokenRes = await fetch(TOKEN_AUDIENCE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!tokenRes.ok) {
    throw new Error("TOKEN_REQUEST_FAILED");
  }

  const tokenData = await tokenRes.json();
  return toStr(tokenData.access_token);
}

async function sheetsRequest(path, accessToken, options = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    throw new Error("SHEETS_REQUEST_FAILED");
  }

  if (res.status === 204) return null;
  return res.json();
}

function sanitizeSheetTitle(customerKey) {
  const safe = toStr(customerKey).replace(/[\\/?*\[\]:]/g, "-").slice(0, 90);
  return safe || "Cliente-SinCodigo";
}

async function getSpreadsheetSheetTitles(spreadsheetId, accessToken) {
  const data = await sheetsRequest(`${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`, accessToken, {
    method: "GET",
  });
  const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
  return sheets.map((sheet) => toStr(sheet?.properties?.title)).filter(Boolean);
}

async function ensureCustomerSheet(spreadsheetId, accessToken, title) {
  const titles = await getSpreadsheetSheetTitles(spreadsheetId, accessToken);
  if (titles.includes(title)) return;

  await sheetsRequest(`${encodeURIComponent(spreadsheetId)}:batchUpdate`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title,
              gridProperties: {
                rowCount: 1000,
                columnCount: 12,
              },
            },
          },
        },
      ],
    }),
  });

  const headers = [[
    "createdAt",
    "orderId",
    "customerKey",
    "customerLabel",
    "totalRounded",
    "hasConsultables",
    "itemsJson",
    "messagePreview",
  ]];

  await sheetsRequest(
    `${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${title}!A1:H1`)}?valueInputOption=RAW`,
    accessToken,
    {
      method: "PUT",
      body: JSON.stringify({ values: headers }),
    }
  );
}

function parseOrderPayload(body) {
  const payload = body && typeof body === "object" ? body : {};

  const customerKey = toStr(payload.customerKey);
  const customerLabel = toStr(payload.customerLabel) || customerKey;
  const orderId = toStr(payload.orderId);
  const createdAt = toStr(payload.createdAt) || new Date().toISOString();
  const totalRounded = Number(payload.totalRounded) || 0;
  const hasConsultables = toBool(payload.hasConsultables);
  const messagePreview = toStr(payload.messagePreview).slice(0, 300);
  const items = Array.isArray(payload.items) ? payload.items : [];

  const code = customerKey.startsWith("C-") ? customerKey.slice(2) : "";
  if (!CODE_REGEX.test(code) || !orderId) {
    return null;
  }

  return {
    customerKey,
    customerLabel,
    orderId,
    createdAt,
    totalRounded,
    hasConsultables,
    messagePreview,
    items,
  };
}

async function appendOrderToSheet(order) {
  const spreadsheetId = toStr(process.env.ORDER_HISTORY_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error("MISSING_SPREADSHEET");
  }

  const accessToken = await getAccessToken();
  const title = sanitizeSheetTitle(order.customerKey);

  await ensureCustomerSheet(spreadsheetId, accessToken, title);

  const row = [[
    order.createdAt,
    order.orderId,
    order.customerKey,
    order.customerLabel,
    Math.round(order.totalRounded),
    order.hasConsultables ? "TRUE" : "FALSE",
    JSON.stringify(order.items || []),
    order.messagePreview,
  ]];

  await sheetsRequest(
    `${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${title}!A:H`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ values: row }),
    }
  );
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  let order = null;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    order = parseOrderPayload(body);
  } catch {
    return res.status(400).json({ ok: false, error: "BAD_REQUEST" });
  }

  if (!order) {
    return res.status(400).json({ ok: false, error: "INVALID_ORDER" });
  }

  try {
    await appendOrderToSheet(order);
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false, error: "SHEET_WRITE_FAILED" });
  }
}
