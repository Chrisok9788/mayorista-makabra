import { defineConfig } from "vite";

/**
 * Configuración Vite estable para hosting estático
 *
 * ✔ Funciona correctamente en Vercel
 * ✔ Funco (si algún día querés) en GitHub Pages
 * ✔ Evita errores de rutas de CSS / JS / assets
 * ✔ No depende de variables de entorno frágiles
 */

export default defineConfig({
  // Base relativa: SOLUCIÓN al problema de Vercel
  base: "./",

  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
