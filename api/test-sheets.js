// api/test-sheets.js
import { google } from "googleapis";

export const config = { runtime: "nodejs" };

function getAuth() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Faltan GOOGLE_CLIENT_EMAIL o GOOGLE_PRIVATE_KEY en Vercel");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export default async function handler(req, res) {
  try {
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const sheetName = process.env.SHEET_NAME || "PRODUCTOS";

    if (!spreadsheetId) {
      return res.status(500).json({ ok: false, error: "Falta SPREADSHEET_ID" });
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Escribir "funciona" en R6
    const range = `${sheetName}!R6`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [["funciona"]] },
    });

    return res.status(200).json({ ok: true, wrote: range, value: "funciona" });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: String(e?.message || e) });
  }
}
