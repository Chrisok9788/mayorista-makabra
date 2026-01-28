// sync/scanntech.api.js
// Este módulo se encarga únicamente de comunicarse con la API de Scanntech

import { CONFIG } from "./config.js";

export async function getProductsFromScanntech() {
  const url = `${CONFIG.SCANNTECH.BASE_URL}/products`;

  // Esta llamada es conceptual.
  // El endpoint real lo define Scanntech.
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${CONFIG.SCANNTECH.API_KEY}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Error al consultar la API de Scanntech");
  }

  const data = await response.json();

  /*
    Esperamos que Scanntech devuelva algo similar a esto:

    [
      {
        id: "12345",
        nombre: "Coca Cola 2L",
        precio_base: 120,
        promociones: [
          {
            min_qty: 4,
            precio: 110
          }
        ]
      }
    ]
  */

  return data;
}
