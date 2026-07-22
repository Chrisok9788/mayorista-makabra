// api/mock-scanntech.js

export const config = {
  runtime: "nodejs",
};

const CACHE_CONTROL = "no-store, max-age=0";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.end(JSON.stringify(body, null, 2));
}

/*
 * API simulada de Scanntech.
 * No consulta ni modifica Supabase.
 * Su único objetivo es entregar datos ficticios para probar
 * el futuro comparador y sincronizador.
 */
export const MOCK_ARTICLES = [
  {
    codigo: "aceite-condesa-900cc-143",
    descripcion: "Aceite Condesa 900Cc",
    precio: 75,
    activo: true,
    promocion: {
      cantidad: 5,
      precioUnitario: 69,
    },
    escenario: "precio_y_promocion_diferentes",
  },
  {
    codigo: "3d-88gr-398",
    descripcion: "3D 88Gr",
    precio: 121,
    activo: true,
    promocion: null,
    escenario: "sin_cambios",
  },
  {
    codigo: "actron-600-10-11",
    descripcion: "Actron 600*10",
    precio: 199,
    activo: true,
    promocion: null,
    escenario: "precio_diferente",
  },
  {
    codigo: "agua-nix-2l-pack-4-3059",
    descripcion: "Agua Nix 2L Pack*4",
    precio: 130,
    activo: false,
    promocion: null,
    escenario: "producto_desactivado",
  },
  {
    codigo: "producto-nuevo-scanntech-900001",
    descripcion: "Producto Nuevo Scanntech",
    precio: 149,
    activo: true,
    promocion: null,
    escenario: "producto_nuevo",
  },
  {
    codigo: "codigo-inexistente-900002",
    descripcion: "Artículo sin coincidencia",
    precio: 89,
    activo: true,
    promocion: null,
    escenario: "sin_coincidencia",
  },
  {
    codigo: "aceite-optimo-900cc-144",
    descripcion: "Aceite Optimo 900Cc",
    precio: 94,
    activo: true,
    promocion: {
      cantidad: 6,
      precioUnitario: 88,
    },
    escenario: "promocion_nueva",
  },
  {
    codigo: "registro-incompleto-900003",
    descripcion: "",
    precio: null,
    activo: true,
    promocion: null,
    escenario: "datos_incompletos",
  },
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  return sendJson(res, 200, {
    proveedor: "scanntech_mock",
    modo: "simulacion",
    empresa: "MAKABRA-DEMO",
    local: "LOCAL-001",
    generadoEn: new Date().toISOString(),
    total: MOCK_ARTICLES.length,
    articulos: MOCK_ARTICLES,
    aviso: "Estos datos son ficticios y no modifican Supabase ni la página web.",
  });
}
