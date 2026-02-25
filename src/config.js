function toStr(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

export const FRONTEND_CONFIG = {
  whatsappPhone: toStr(import.meta.env.VITE_WHATSAPP_PHONE, "59800000000"),
  csvUrl: toStr(import.meta.env.VITE_CSV_URL, ""),
  deliveryDirectoryCsvUrl: toStr(import.meta.env.VITE_DELIVERY_DIRECTORY_CSV_URL, ""),
  apiBase: toStr(import.meta.env.VITE_API_BASE, "").replace(/\/$/, ""),
};
