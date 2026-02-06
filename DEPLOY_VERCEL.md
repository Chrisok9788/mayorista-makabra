# Deploy en Vercel

## Pasos (copiar/pegar)

1) Conectar el repo en Vercel (Import Project).
2) Framework preset: **Vite**.
3) Build Command: `npm run build`.
4) Output Directory: `dist`.
5) (Opcional) Variables de entorno:
   - `CSV_URL`: URL pública del Google Sheets (output=csv). Si no se configura, se usa la URL hardcodeada actual.
   - `VITE_API_BASE`: base URL para consumir `/api/catalog` fuera de Vercel (ej: build Capacitor). En Vercel se deja vacío.
6) Deploy.

## Cómo funciona
- El frontend consume `/api/catalog`.
- `/api/catalog` descarga el CSV, lo normaliza y responde JSON con cache:
  `Cache-Control: s-maxage=300, stale-while-revalidate=3600`.
- El frontend cachea el último catálogo válido en `localStorage` y se actualiza en background.

## Troubleshooting
- **/api/catalog responde error 502/500**: verificar que el CSV esté publicado y accesible como `output=csv`.
- **Timeout (504)**: aumentar la calidad de conexión o revisar el tamaño del CSV.
- **Catálogo vacío**: validar que exista columna `id` con valores no vacíos.
- **Vercel no encuentra output**: asegurarse de que el build genere `dist/`.
