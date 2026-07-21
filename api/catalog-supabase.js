// api/catalog-supabase.js
export const config = { runtime: "nodejs" };

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=1800";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", CACHE_CONTROL);
  res.end(JSON.stringify(body));
}

function toTags(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  return text
    .split(/[;,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mapProduct(row) {
  const promoMin = Number(row.promo_min_qty || 0);
  const promoPrice = Number(row.promo_precio || 0);
  const dpc =
    promoMin > 0 && promoPrice > 0
      ? { tramos: [{ min: promoMin, precio: promoPrice }] }
      : undefined;

  return {
    id: row.id,
    nombre: row.nombre || row.id,
    categoria: row.categoria || "Otros",
    subcategoria: row.subcategoria || "Otros",
    precio: Number(row.precio_base || 0),
    oferta: Boolean(row.oferta_carrusel),
    imagen: row.imagen_url || null,
    marca: row.marca || null,
    presentacion: row.presentacion || null,
    tags: toTags(row.tags),
    destacado: Boolean(row.destacados),
    promo_group: row.promo_group || null,
    ...(dpc ? { dpc } : {}),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method Not Allowed" });
  }

  const baseUrl = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !secret) {
    return sendJson(res, 500, {
      error: "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel",
    });
  }

  try {
    const products = [];
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/rest/v1/productos`);
      endpoint.searchParams.set(
        "select",
        "id,nombre,categoria,subcategoria,precio_base,oferta_carrusel,destacados,promo_group,promo_min_qty,promo_precio,imagen_url,marca,presentacion,tags,prioridad_oferta",
      );
      endpoint.searchParams.set("activo", "eq.true");
      endpoint.searchParams.set("order", "prioridad_oferta.desc,nombre.asc");
      endpoint.searchParams.set("limit", String(pageSize));
      endpoint.searchParams.set("offset", String(offset));

      const response = await fetch(endpoint, {
        cache: "no-store",
        headers: {
          apikey: secret,
          Authorization: `Bearer ${secret}`,
          Accept: "application/json",
        },
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Supabase ${response.status}: ${text.slice(0, 700)}`);
      }

      const page = JSON.parse(text);
      if (!Array.isArray(page)) throw new Error("Supabase devolvió una respuesta inesperada");

      products.push(...page.map(mapProduct));
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    return sendJson(res, 200, {
      products,
      updatedAt: Date.now(),
      degraded: false,
      source: "supabase",
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: "No se pudo cargar el catálogo desde Supabase",
      message: String(error?.message || error),
      degraded: true,
    });
  }
}
