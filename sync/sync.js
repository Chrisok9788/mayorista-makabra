// sync/sync.js
// Orquestador general de la sincronización Scanntech → Google Sheets

import { getProductsFromScanntech } from "./scanntech.api.js";
import { syncProductInSheets } from "./sheets.client.js";

async function runSync() {
  try {
    console.log("Iniciando sincronización Scanntech → Google Sheets");

    const products = await getProductsFromScanntech();

    for (const product of products) {
      await syncProductInSheets(product);
    }

    console.log("Sincronización finalizada correctamente");
  } catch (error) {
    console.error("Error en sincronización:", error.message);
  }
}

runSync();
