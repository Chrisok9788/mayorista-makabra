
#!/usr/bin/env node
/**
 * Script mejorado para convertir productos desde Excel a JSON limpio.
 */

import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';

const args = process.argv.slice(2);
const inputPath = args[0] || path.join('data', 'productos.xlsx');
const outputPath = path.join('public', 'data', 'products.json');

function slugify(text) {
  return text.toString().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function generateId(product, existingIds) {
  const parts = [product.nombre, product.presentacion, product.marca]
    .filter(Boolean).map(slugify);
  let baseId = parts.join("-");
  let id = baseId;
  let i = 2;
  while (existingIds.has(id)) {
    id = baseId + "-" + i++;
  }
  existingIds.add(id);
  return id;
}

function cleanProduct(p) {
  const cleaned = {};
  for (const key in p) {
    const val = p[key];
    if (val !== null && val !== undefined && val !== "") {
      cleaned[key] = typeof val === "string" ? val.trim() : val;
    }
  }
  return cleaned;
}

try {
  const workbook = xlsx.readFile(inputPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet);
  const seenIds = new Set();

  const productos = raw
    .map(cleanProduct)
    .filter(p => p.nombre && p.categoria)
    .map(p => {
      p.id = generateId(p, seenIds);
      if (typeof p.tags === "string") {
        p.tags = p.tags.split(",").map(t => t.trim()).filter(Boolean);
      }
      return p;
    });

  fs.writeFileSync(outputPath, JSON.stringify(productos, null, 2), "utf8");
  console.log(`✅ ${productos.length} productos exportados a ${outputPath}`);
} catch (err) {
  console.error("❌ Error al procesar el archivo:", err.message);
  process.exit(1);
}
