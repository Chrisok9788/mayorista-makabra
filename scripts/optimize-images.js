import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT_DIR = process.cwd();
const IMAGES_DIR = path.join(ROOT_DIR, 'public', 'images');
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.avif', '.tiff', '.bmp']);
const MAX_WIDTH = 800;

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function walkDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function convertToWebp(sourcePath) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) return { skipped: true, reason: 'unsupported' };

  const outputPath = sourcePath.replace(/\.[^/.]+$/, '.webp');
  if (await pathExists(outputPath)) return { skipped: true, reason: 'exists', outputPath };

  try {
    const image = sharp(sourcePath, { failOn: 'none' });
    const metadata = await image.metadata();
    const resizeOptions = metadata.width && metadata.width > MAX_WIDTH ? { width: MAX_WIDTH, withoutEnlargement: true } : undefined;

    await image
      .rotate()
      .resize(resizeOptions)
      .webp({ quality: 82, effort: 6 })
      .toFile(outputPath);

    return { skipped: false, outputPath };
  } catch (error) {
    return { skipped: true, reason: 'error', error };
  }
}

async function main() {
  if (!(await pathExists(IMAGES_DIR))) {
    console.warn(`[optimize-images] Directory not found: ${IMAGES_DIR}`);
    return;
  }

  const files = await walkDir(IMAGES_DIR);
  let converted = 0;
  let skipped = 0;

  for (const file of files) {
    const result = await convertToWebp(file);
    if (result.skipped) {
      skipped += 1;
      if (result.reason === 'error') {
        console.error(`[optimize-images] Error processing ${file}:`, result.error);
      }
    } else {
      converted += 1;
      console.log(`[optimize-images] Created: ${result.outputPath}`);
    }
  }

  console.log(`[optimize-images] Done. Converted: ${converted}. Skipped: ${skipped}.`);
}

main().catch((error) => {
  console.error('[optimize-images] Fatal error:', error);
  process.exitCode = 1;
});
