export const config = { runtime: "nodejs" };

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
  }

  const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const secret = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!baseUrl || !secret) return sendJson(res, 500, { error: "missing_supabase_env" });

  try {
    const response = await fetch(`${baseUrl}/rest/v1/`, {
      cache: "no-store",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        Accept: "application/openapi+json, application/json",
      },
    });
    const spec = await response.json();
    const schemas = spec?.definitions || spec?.components?.schemas || {};
    const simplify = (name) => {
      const schema = schemas[name] || {};
      return {
        required: schema.required || [],
        columns: Object.fromEntries(
          Object.entries(schema.properties || {}).map(([key, value]) => [key, {
            type: value.type || null,
            format: value.format || null,
            description: value.description || null,
          }]),
        ),
      };
    };

    return sendJson(res, 200, {
      categorias: simplify("categorias"),
      subcategorias: simplify("subcategorias"),
    });
  } catch (error) {
    return sendJson(res, 500, { error: String(error?.message || error) });
  }
}
