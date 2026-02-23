// api/test-sheets.js
import { SignJWT, importPKCS8 } from "jose";

export const config = { runtime: "nodejs" };

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta ${name} en Vercel`);
  return v;
}

async function getAccessToken() {
  const clientEmail = must("GOOGLE_CLIENT_EMAIL");
  const rawKey = must("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const now = Math.floor(Date.now() / 1000);

  // Google acepta RS256 con PKCS8
  const key = await importPKCS8(rawKey, "RS256");

  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/spreadsheets",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Token error: ${r.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

export default async function handler(req, res) {
  try {
    const spreadsheetId = must("SPREADSHEET_ID");
    const sheetName = must("SHEET_NAME"); // PRODUCTOS
    const token = await getAccessToken();

    // Escribir "funciona" en R6
    const range = encodeURIComponent(`${sheetName}!R6`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`;

    const r = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [["funciona"]] }),
    });

    const out = await r.json();
    if (!r.ok) throw new Error(`Sheets error: ${r.status} ${JSON.stringify(out)}`);

    res.status(200).json({ ok: true, wrote: `${sheetName}!R6`, value: "funciona" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
