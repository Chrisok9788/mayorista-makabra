import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// Base:
// - "/" para Vercel
// - "./" para Android / Capacitor
const base = process.env.VITE_BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "images/**/*", // carpeta que TENÉS en el repo
          dest: "images",     // se copiará a dist/images
        },
      ],
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
