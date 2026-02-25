// sync/config.js
// Configuración por variables de entorno (sin hardcodes operativos)

export const CONFIG = {
  SCANNTECH: {
    BASE_URL: process.env.SCANNTECH_BASE_URL || "",
    API_KEY: process.env.SCANNTECH_API_KEY || "",
  },
  SHEETS: {
    SPREADSHEET_ID: process.env.PRODUCTS_SHEET_ID || "",
    SHEET_PRODUCTOS: process.env.PRODUCTS_SHEET_TAB || "products",
    SHEET_PENDIENTES: process.env.SHEET_PENDIENTES || "pendientes",
  },
};
