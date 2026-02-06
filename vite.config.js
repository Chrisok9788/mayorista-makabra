import { defineConfig } from "vite";

// Vite configuration for static hosting.
// Default base is "/" for platforms like Vercel.
// Set VITE_BASE (e.g. "/mayorista-makabra-web/") for GitHub Pages.
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
