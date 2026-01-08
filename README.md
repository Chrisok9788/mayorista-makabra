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

1. Editá el archivo Excel en `data/productos.xlsx`. Cada fila representa un producto. Las columnas soportadas son:
   - **nombre** (obligatorio): nombre del producto.
   - **categoria** (obligatorio): categoría o rubro (p. ej. “Bebidas”, “Alimentos”, etc.).
   - **marca** (opcional)
   - **presentacion** (opcional): presentación, formato o volumen (p. ej. “1L”, “6u”, “500g”).
   - **precio** (opcional): número sin símbolo; dejar vacío para mostrar “Consultar”.
   - **imagen** (opcional): URL o ruta a la imagen (dejar vacío para usar `placeholder.png`).
   - **stock** (opcional): texto informativo de stock.
   - **tags** (opcional): palabras clave separadas por comas para mejorar las búsquedas.

2. Ejecutá el script que convierte el Excel en JSON:

```bash
npm run build:products
```

   Esto genera o actualiza `public/data/products.json` con los productos y crea un `id` único para cada uno.

3. (Opcional) Si añadís imágenes nuevas, colocalas en `public/` o una carpeta accesible y especificá su ruta en la columna **imagen**.

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

---

### Personalizaciones

- **Colores y estilos:** modificá variables en `style.css` (`--color-primary`, `--color-accent`, etc.).
- **Texto e información de contacto:** editá `index.html` en las secciones correspondientes.
- **SEO:** ajustá `<title>`, meta descripciones y `public/sitemap.xml`.

¡Con esto tendrás un sitio completo listo para ser publicado y administrar tu catálogo de mayorista sin complicaciones!
