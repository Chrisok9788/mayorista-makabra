import { defineConfig } from "vite";

// Vite configuration for a static site hosted on GitHub Pages.
// The `base` option must match the repository name when deploying
// to GitHub Pages so that assets load correctly. Adjust if your
// repository name differs.
const base = process.env.VITE_BASE ?? "/mayorista-makabra-web/";

export default defineConfig({
  base,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
