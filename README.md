# Mayorista Makabra Web

Sitio estático para el mayorista **Makabra**, orientado a revendedores en Uruguay. Permite ver el catálogo de productos, buscarlos por nombre/marca/categoría, agregarlos al carrito y enviar el pedido por WhatsApp. Los productos se cargan desde un archivo Excel para facilitar el mantenimiento.

## Requisitos

- Node.js ≥ 18 (incluye npm)

## Instalación

Cloná el repositorio y navegá a su carpeta:

```bash
git clone https://github.com/TU_USUARIO/mayorista-makabra-web.git
cd mayorista-makabra-web
```

Instalá las dependencias:

```bash
npm install
```

## Cargar/actualizar productos

El sitio consume productos desde Google Sheets como CSV (ver `PRODUCTS_URL` en `data.js`). Para actualizar el catálogo:

1. Editá la hoja publicada en Google Sheets (columnas: **nombre**, **categoria**, **marca**, **presentacion**, **precio**, **imagen**, **stock**, **tags**, **promo_group**, **Destacados**).
2. Verificá que el CSV siga publicado y que el link esté actualizado en `data.js`.

### Google Sheets (robusto + caché)

- **Endpoint actual:** se configura en `PRODUCTS_URL` dentro de `data.js`.
- **Formato esperado:** columnas como `id`, `nombre`, `categoria`, `subcategoria`, `precio_base`, `imagen` (o `imagen_url`), `stock`, `tags`, `Destacados`, etc.
- **Caché local:** si la carga desde Sheets falla, la app muestra el último catálogo guardado en `localStorage` y avisa en pantalla.
- **Timeout:** la carga remota corta a los ~10s para evitar “cuelgues” en la app.
- **Offline básico:** Service Worker cachea assets estáticos para abrir la app sin conexión.

### Opción alternativa (Excel local)

Si preferís generar un JSON local desde Excel:

1. Guardá el Excel como `data/productos.xlsx`.
2. Ejecutá:

```bash
npm run build:products
```

Esto genera o actualiza `products.json` en la raíz del repo con los productos y crea un `id` único para cada uno.

## Ejecutar en desarrollo

Para arrancar un servidor de desarrollo con recarga en caliente:

```bash
npm run dev
```

Esto abrirá el sitio en `http://localhost:5173`. Si modificás archivos fuente, la página se actualizará automáticamente.

## Construir la versión de producción

Para generar una versión optimizada del sitio en la carpeta `dist`:

```bash
npm run build:products
npm run build
```

El primer comando asegura que el JSON de productos está actualizado antes de construir.

## Android (APK) con Capacitor

Este repo **no versiona** el proyecto Android para mantenerlo limpio. El flujo recomendado:

```bash
./scripts/prepare-android-repo.sh
```

Esto crea un repo local hermano (`../mayorista-makabra-android`) y deja el actual intacto.

Si preferís hacerlo manual:

```bash
npm install
npm run build:android
npm run android:init
npm run android:sync
npm run android:open
```

> Nota: `build:android` usa `VITE_BASE=./` para que los assets se carguen bien en WebView.

## Desplegar en GitHub Pages

Este repositorio incluye una GitHub Action (`.github/workflows/deploy.yml`) que se ejecuta automáticamente en cada push a `main`. La acción:

1. Instala las dependencias.
2. Corre `npm run build:products` para convertir el Excel.
3. Corre `npm run build` para crear el sitio.
4. Publica el contenido de `dist` en GitHub Pages.

Para que el despliegue funcione correctamente:

- Asegurate de que el repositorio se llama **`mayorista-makabra-web`** (o ajustá la opción `base` en `vite.config.js`).
- Habilitá GitHub Pages en la sección **Settings > Pages**, seleccionando la fuente “GitHub Actions”.
- Cambiá `TU_USUARIO` por tu usuario u organización en `public/robots.txt` y `public/sitemap.xml`.

Después del despliegue, tu sitio estará disponible en:

```
https://TU_USUARIO.github.io/mayorista-makabra-web/
```

## Comandos rápidos

| Acción                              | Comando                         |
| ----------------------------------- | ------------------------------ |
| Instalar dependencias               | `npm install`                  |
| Correr en modo desarrollo           | `npm run dev`                  |
| Convertir Excel a JSON              | `npm run build:products`       |
| Generar build de producción         | `npm run build`                |
| Previsualizar build local           | `npm run preview`              |
| Ejecutar tests                      | `npm run test`                 |

---

### Personalizaciones

- **Colores y estilos:** modificá variables en `style.css` (`--color-primary`, `--color-accent`, etc.).
- **Texto e información de contacto:** editá `index.html` en las secciones correspondientes.
- **SEO:** ajustá `<title>`, meta descripciones y `public/sitemap.xml`.

¡Con esto tendrás un sitio completo listo para ser publicado y administrar tu catálogo de mayorista sin complicaciones!

## Modo Reparto (opcional)

### Configuración en Vercel (dónde poner el enlace)

En **Vercel → tu proyecto → Settings → Environment Variables** cargá una de estas opciones:

1. **Opción simple (recomendada):**
   - `DELIVERY_DIRECTORY_SHEET_ID`: ID de la planilla Google Sheets.
   - `DELIVERY_DIRECTORY_SHEET_GID` (opcional): GID de la pestaña (por defecto `0`).

2. **Opción URL directa:**
   - `DELIVERY_DIRECTORY_CSV_URL`: URL CSV publicada desde Google Sheets.

3. **Fallback opcional:**
   - `DELIVERY_DIRECTORY_JSON`: directorio en JSON usado si falla la carga desde Sheets.

> El backend prioriza `DELIVERY_DIRECTORY_CSV_URL`. Si no existe, arma la URL con `DELIVERY_DIRECTORY_SHEET_ID` + `DELIVERY_DIRECTORY_SHEET_GID`.

Ejemplo de `DELIVERY_DIRECTORY_SHEET_ID`:

`https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0`

En ese caso, el ID es: `1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890`

### Parámetros de la planilla Google Sheets (CSV)

Publicá la hoja como CSV con estos encabezados:

- `code` (obligatorio): **código numérico de 5 dígitos**.
- `name` (obligatorio): nombre del repartidor/cliente.
- `address` (obligatorio): dirección.
- `phone` (obligatorio): teléfono.

También se aceptan alias de columnas: `codigo` para `code`, `nombre` para `name`, `direccion` para `address`, `telefono` para `phone`.

Ejemplo CSV:

```csv
code,name,address,phone
12345,Juan Perez,Av Italia 1234,099123456
54321,Maria Lopez,8 de Octubre 555,098222333
```

### Fallback opcional con JSON

```json
[
  {"code":"12345","name":"Juan Perez","address":"Av Italia 1234","phone":"099123456"},
  {"code":"54321","name":"Maria Lopez","address":"8 de Octubre 555","phone":"098222333"}
]
```

### Probar endpoint

```bash
curl -X POST https://TU-DOMINIO.vercel.app/api/validate-delivery \
  -H "Content-Type: application/json" \
  -d '{"code":"12345"}'
```

> Después de agregar o cambiar variables de entorno en Vercel, hacé **Redeploy** para aplicar cambios.

## Primer deploy (Vercel)
1. Importar repo en Vercel.
2. Cargar variables de entorno de `docs/HANDOVER.md` en Preview y Production.
3. Deploy y verificar:
   - `GET /api/catalog`
   - `POST /api/order-history` con `X-APP-TOKEN`
   - `POST /api/sync-scanntech/run` con `X-SYNC-TOKEN`

## Cambio de dueño
1. Transferir proyecto Vercel al nuevo owner/team.
2. Re-cargar todas las env vars y rotar `APP_TOKEN` + `SYNC_TOKEN`.
3. Transferir acceso a Google Sheet + Service Account.
4. Verificar cron en Vercel y su header de autenticación.
