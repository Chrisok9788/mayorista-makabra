import fs from 'fs';
import path from 'path';

const ROOT_DIR = process.cwd();
const PRODUCTS_PATH = path.join(ROOT_DIR, 'products.json');
const IMAGES_DIR = path.join(ROOT_DIR, 'public', 'images');
const REPORT_PATH = path.join(ROOT_DIR, 'missing_images_report.csv');

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function ensureInputs() {
  if (!fileExists(PRODUCTS_PATH)) {
    console.error(`[audit-images] Error: no se encontró el archivo requerido: ${PRODUCTS_PATH}`);
    process.exit(1);
  }

  if (!fileExists(IMAGES_DIR)) {
    console.error(`[audit-images] Error: no se encontró el directorio requerido: ${IMAGES_DIR}`);
    process.exit(1);
  }

  const imagesStat = fs.statSync(IMAGES_DIR);
  if (!imagesStat.isDirectory()) {
    console.error(`[audit-images] Error: la ruta de imágenes no es un directorio válido: ${IMAGES_DIR}`);
    process.exit(1);
  }
}

function parseProducts() {
  try {
    const raw = fs.readFileSync(PRODUCTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error('El contenido de products.json debe ser un array de productos.');
    }

    return parsed;
  } catch (error) {
    console.error(`[audit-images] Error al leer o parsear products.json: ${error.message}`);
    process.exit(1);
  }
}

function getPhysicalImageSet() {
  try {
    const dirEntries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true });
    const fileNamesLower = dirEntries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.toLowerCase());

    return new Set(fileNamesLower);
  } catch (error) {
    console.error(`[audit-images] Error al leer el directorio de imágenes: ${error.message}`);
    process.exit(1);
  }
}

function escapeCsvValue(value) {
  const safeValue = value == null ? '' : String(value);
  const escaped = safeValue.replaceAll('"', '""');
  return `"${escaped}"`;
}

function buildReportRows(products, physicalImages) {
  return products.map((p) => {
    const resolvedId = p?.scanntechId || p?.id;
    const id = resolvedId == null ? '' : String(resolvedId).trim();
    const expectedFile = `${id}.jpg`.toLowerCase();
    const exists = id.length > 0 && physicalImages.has(expectedFile);

    return {
      id,
      nombre: p?.nombre ?? p?.name ?? '',
      rutaSugeridaSheets: `images/${expectedFile}`,
      estado: exists ? 'OK' : 'FALTA_ARCHIVO',
    };
  });
}

function writeCsv(rows) {
  const header = [
    'ID',
    'NOMBRE',
    'RUTA_SUGERIDA_SHEETS',
    'ESTADO_FISICO',
  ].join(',');

  const lines = rows.map((row) => {
    return [
      escapeCsvValue(row.id),
      escapeCsvValue(row.nombre),
      escapeCsvValue(row.rutaSugeridaSheets),
      escapeCsvValue(row.estado),
    ].join(',');
  });

  const csv = `${header}\n${lines.join('\n')}\n`;
  fs.writeFileSync(REPORT_PATH, csv, 'utf8');
}

function main() {
  ensureInputs();

  const products = parseProducts();
  const physicalImages = getPhysicalImageSet();
  const rows = buildReportRows(products, physicalImages);

  const foundCount = rows.filter((row) => row.estado === 'OK').length;
  const missingCount = rows.length - foundCount;

  writeCsv(rows);

  console.log('[audit-images] Auditoría finalizada.');
  console.log(`[audit-images] Total de productos analizados: ${rows.length}`);
  console.log(`[audit-images] Imágenes encontradas: ${foundCount}`);
  console.log(`[audit-images] Imágenes faltantes: ${missingCount}`);
  console.log(`[audit-images] Reporte generado en: ${REPORT_PATH}`);
}

main();
