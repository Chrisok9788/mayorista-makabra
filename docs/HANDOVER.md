# Handover Operativo (Nuevo Dueño)

## Variables de entorno (Vercel: Preview + Production)
- `APP_TOKEN`
- `SYNC_TOKEN`
- `CSV_URL`
- `ORDER_HISTORY_SPREADSHEET_ID` (o usar `DELIVERY_DIRECTORY_SHEET_ID`)
- `DELIVERY_DIRECTORY_CSV_URL`
- `DELIVERY_DIRECTORY_SHEET_ID`
- `DELIVERY_DIRECTORY_SHEET_GID`
- `DELIVERY_DIRECTORY_JSON`
- `DELIVERY_EXPOSE_PII`
- `SCANNTECH_BASE_URL`
- `SCANNTECH_API_KEY`
- `SCANNTECH_PRODUCTS_PATH`
- `SCANNTECH_TIMEOUT_MS`
- `PRODUCTS_SHEET_ID`
- `PRODUCTS_SHEET_TAB`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `VITE_WHATSAPP_PHONE`
- `VITE_CSV_URL`
- `VITE_DELIVERY_DIRECTORY_CSV_URL`
- `VITE_API_BASE`

## Correr sync manual
```bash
curl -X POST "$BASE_URL/api/sync-scanntech/run" -H "X-SYNC-TOKEN: $SYNC_TOKEN"
curl "$BASE_URL/api/sync-scanntech/status" -H "X-SYNC-TOKEN: $SYNC_TOKEN"
```

## Cron en Vercel
1. Project → Settings → Cron Jobs.
2. Crear cron a `POST /api/sync-scanntech/run`.
3. Enviar header `X-SYNC-TOKEN`.
4. Revisar logs de Functions.
