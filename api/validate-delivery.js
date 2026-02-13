const CODE_REGEX = /^\d{7,8}$/;

function sanitizeCode(input) {
  return String(input ?? "").replace(/\D/g, "").trim();
}

function getLast3(code) {
  const value = String(code || "");
  return value.slice(-3);
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

function sanitizeProfile(entry) {
  if (!entry || typeof entry !== "object") return null;

  const code = sanitizeCode(entry.code);
  const name = String(entry.name ?? "").trim();
  const address = String(entry.address ?? "").trim();
  const phone = String(entry.phone ?? "").trim();

  if (!CODE_REGEX.test(code) || !name || !address || !phone) {
    return null;
  }

  return { code, name, address, phone };
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
    const directory = readDirectoryFromEnv();
    const match = directory.find((entry) => sanitizeCode(entry?.code) === code);
    const profile = sanitizeProfile(match);

    if (!profile) {
      return res.status(404).json({ valid: false, error: "NOT_FOUND" });
    }

    return res.status(200).json({ valid: true, profile });
  } catch (error) {
    console.error("[delivery] validation failed for ***" + getLast3(code));
    return res.status(500).json({ valid: false, error: "INTERNAL_ERROR" });
  }
}
