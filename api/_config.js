function toStr(v) {
  return String(v ?? "").trim();
}

function toBool(v, fallback = false) {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return fallback;
}

export function getApiConfig() {
  return {
    appToken: toStr(process.env.APP_TOKEN),
    syncToken: toStr(process.env.SYNC_TOKEN),
    csvUrl: toStr(process.env.CSV_URL),
    deliveryDirectoryCsvUrl: toStr(process.env.DELIVERY_DIRECTORY_CSV_URL),
    deliveryExposePii: toBool(process.env.DELIVERY_EXPOSE_PII, false),
    scanntechBaseUrl: toStr(process.env.SCANNTECH_BASE_URL),
    scanntechApiKey: toStr(process.env.SCANNTECH_API_KEY),
    scanntechProductsPath: toStr(process.env.SCANNTECH_PRODUCTS_PATH) || "/products",
    scanntechTimeoutMs: Number(process.env.SCANNTECH_TIMEOUT_MS || 12000),
    productsSheetId: toStr(process.env.PRODUCTS_SHEET_ID),
    productsSheetTab: toStr(process.env.PRODUCTS_SHEET_TAB) || "products",
    googleServiceAccountJson: toStr(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
  };
}

export function getHeader(req, name) {
  return toStr(req?.headers?.[name.toLowerCase()] ?? req?.headers?.[name]);
}

export function sanitizeIp(req) {
  return toStr(req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
}
