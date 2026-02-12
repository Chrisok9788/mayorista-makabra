import { constants } from 'node:fs';
import { access, cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_DIR = path.resolve(process.cwd(), 'images');
const TARGET_DIR = path.resolve(process.cwd(), 'public', 'images');

async function pathExists(targetPath) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function moveEntry(sourcePath, targetPath) {
  try {
    await rename(sourcePath, targetPath);
    return;
  } catch (error) {
    // EXDEV ocurre cuando se mueve entre diferentes dispositivos/mount points.
    if (error?.code !== 'EXDEV') {
      throw error;
    }
  }

  const sourceStats = await stat(sourcePath);

  if (sourceStats.isDirectory()) {
    await mkdir(targetPath, { recursive: true });
    await cp(sourcePath, targetPath, { recursive: true, force: true });
    await rm(sourcePath, { recursive: true, force: true });
    return;
  }

  await cp(sourcePath, targetPath, { force: true });
  await rm(sourcePath, { force: true });
}

async function moveDirectoryContents(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await moveDirectoryContents(sourcePath, targetPath);
      await rm(sourcePath, { recursive: true, force: true });
      continue;
    }

    await moveEntry(sourcePath, targetPath);
  }
}

async function moveImagesFolder() {
  const sourceExists = await pathExists(SOURCE_DIR);

  if (!sourceExists) {
    console.log(`No existe la carpeta de origen: ${SOURCE_DIR}. No hay nada para mover.`);
    return;
  }

  await mkdir(TARGET_DIR, { recursive: true });
  await moveDirectoryContents(SOURCE_DIR, TARGET_DIR);
  await rm(SOURCE_DIR, { recursive: true, force: true });

  console.log(`Movimiento completado: "${SOURCE_DIR}" -> "${TARGET_DIR}"`);
}

moveImagesFolder().catch((error) => {
  console.error('Error al mover la carpeta images:', error);
  process.exitCode = 1;
});
