#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR%/}-android"

if [ -d "${TARGET_DIR}" ]; then
  echo "El directorio ${TARGET_DIR} ya existe. Borrálo o usá otro nombre."
  exit 1
fi

git clone "${ROOT_DIR}" "${TARGET_DIR}"

cd "${TARGET_DIR}"
npm install
npm run build:android
npm run android:init
npm run android:sync

echo "Listo. Abrí Android Studio con: cd ${TARGET_DIR} && npm run android:open"
