# Changelog

## 2026-02-24
- Seguridad: `POST /api/order-history` ahora requiere `X-APP-TOKEN` contra `APP_TOKEN`.
- Seguridad: `POST /api/validate-delivery` ahora tiene rate limit por IP (60 req/min), minimiza PII por defecto y permite `DELIVERY_EXPOSE_PII=true`.
- Seguridad: sync Scanntech acepta solo header `X-SYNC-TOKEN` (sin query token).
- Config centralizada:
  - Frontend: `src/config.js` (`import.meta.env`).
  - Backend: `api/_config.js` (`process.env`).
- Hardcodes removidos en WhatsApp y fuentes CSV críticas.
- Sync productivo Scanntech:
  - Endpoint operativo con persistencia real en Google Sheets.
  - Alias/rewrites para `/api/sync-scanntech/run` y `/api/sync-scanntech/status`.
  - Upsert por `scanntech_id`/`barcode`, manejo de `activo`, promos en JSON, preservación de imagen existente.
  - Registro de corridas en hoja `sync_runs`, lock en memoria para evitar corridas simultáneas, retry con backoff en escrituras.
- Vercel: `vercel.json` actualizado con headers de seguridad/no-cache para APIs sensibles.
- CI: `.github/workflows/update-products.yml` reemplazado por workflow YAML válido (antes contenía script Python inválido para Actions).
- Compatibilidad Node: `package.json` agrega `engines.node >=20`.
- Documentación: `docs/HANDOVER.md` y README con deploy inicial, handover y operación de sync.
