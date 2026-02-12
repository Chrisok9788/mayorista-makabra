import { z } from 'zod';

const ProductSchema = z
  .object({
    id: z.string().trim().min(1),
    nombre: z.string().trim().min(1),
    categoria: z.string().trim().min(1),
    subcategoria: z.string().trim().optional().default(''),
    imagen: z.string().trim().optional().default(''),
    marca: z.string().trim().optional().default(''),
    presentacion: z.string().trim().optional().default(''),
    precio: z.number().finite().nonnegative(),
    oferta: z.number().finite().nonnegative().optional().default(0),
    stock: z.number().int().nonnegative().optional().default(0),
    destacado: z.boolean().optional().default(false),
    tags: z.array(z.string().trim()).optional().default([]),
  })
  .strip();

const TRUE_VALUES = new Set(['true', 'verdadero', '1', 'si', 'sí', 'yes']);
const FALSE_VALUES = new Set(['false', 'falso', '0', 'no']);

function toStringValue(value) {
  return String(value ?? '').trim();
}

function toNumberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const raw = toStringValue(value);
  if (!raw) return NaN;
  const normalized = raw.replace(/\$/g, '').replace(/\./g, '').replace(/,/g, '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toBooleanValue(value) {
  if (typeof value === 'boolean') return value;
  const normalized = toStringValue(value).toLowerCase();
  if (!normalized) return false;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return false;
}

function toTags(value) {
  const text = toStringValue(value);
  if (!text) return [];
  return text
    .split(/[;,]/g)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseCsv(csvText) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      currentCell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);
  return rows;
}

function mapRowsToObjects(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const headers = rows[0].map((header) => toStringValue(header));
  return rows.slice(1).map((row) => {
    const rowObject = {};

    for (let index = 0; index < headers.length; index += 1) {
      const key = headers[index];
      if (!key) continue;
      rowObject[key] = row[index] ?? '';
    }

    return rowObject;
  });
}

function normalizeProductRow(row) {
  return {
    id: toStringValue(row.id ?? row.ID),
    nombre: toStringValue(row.nombre ?? row.producto ?? row.name),
    categoria: toStringValue(row.categoria ?? row.rubro ?? row.category),
    subcategoria: toStringValue(row.subcategoria ?? row.sub_category),
    imagen: toStringValue(row.imagen ?? row.image),
    marca: toStringValue(row.marca ?? row.brand),
    presentacion: toStringValue(row.presentacion ?? row.presentation),
    precio: toNumberValue(row.precio ?? row.price),
    oferta: toNumberValue(row.oferta ?? row.offer ?? 0),
    stock: Math.max(0, Math.trunc(toNumberValue(row.stock ?? row.inventory ?? 0) || 0)),
    destacado: toBooleanValue(row.destacado ?? row.Destacados),
    tags: toTags(row.tags ?? row.etiquetas),
  };
}

export async function fetchProductsFromSheets(csvUrl) {
  try {
    const response = await fetch(csvUrl, {
      method: 'GET',
      headers: { Accept: 'text/csv,text/plain,*/*' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }

    const csvText = await response.text();
    const rows = mapRowsToObjects(parseCsv(csvText));

    const validProducts = [];

    for (const row of rows) {
      const normalized = normalizeProductRow(row);
      const parsed = ProductSchema.safeParse(normalized);

      if (parsed.success) {
        validProducts.push(parsed.data);
      } else {
        console.warn('[data] Invalid CSV row skipped:', {
          row,
          issues: parsed.error.issues,
        });
      }
    }

    return validProducts;
  } catch (error) {
    console.error('[data] Failed to fetch/parse products from Google Sheets CSV.', error);
    return [];
  }
}

export { ProductSchema };
