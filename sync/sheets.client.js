// sync/sheets.client.js
// Este módulo se encarga únicamente de escribir y actualizar Google Sheets

import { CONFIG } from "./config.js";

export async function syncProductInSheets(product) {
  /*
    Lógica esperada (conceptual):

    1. Buscar en la hoja PRODUCTOS por scanntech_id
    2. Si existe:
       - actualizar nombre
       - actualizar precio_base
       - actualizar promociones por cantidad
    3. Si NO existe:
       - insertar el producto en la hoja PENDIENTES

    Este archivo NO decide categorías, imágenes ni estados comerciales.
    Solo sincroniza datos técnicos.
  */

  console.log(
    `Sincronizando producto ${product.id} - ${product.nombre}`
  );
}
