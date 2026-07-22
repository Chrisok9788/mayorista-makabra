export const config = { runtime: "nodejs" };

function toStr(value) {
  return String(value ?? "").trim();
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function slugify(value) {
  return toStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sin-nombre";
}

function supabaseConfig() {
  const baseUrl = toStr(process.env.SUPABASE_URL).replace(/\/$/, "");
  const secret = toStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!baseUrl || !secret) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel");
  }
  return { baseUrl, secret };
}

async function supabaseRequest(path, options = {}) {
  const { baseUrl, secret } = supabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: options.prefer || "return=minimal",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text.slice(0, 900)}`);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function loadOpenApi() {
  const { baseUrl, secret } = supabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/`, {
    cache: "no-store",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Accept: "application/openapi+json, application/json",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`No se pudo leer el esquema REST: Supabase ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

function resolveSchema(spec, tableName) {
  const schemas = spec?.definitions || spec?.components?.schemas || {};
  if (schemas[tableName]) return schemas[tableName];

  const key = Object.keys(schemas).find(
    (name) => name.toLowerCase() === tableName.toLowerCase() || name.endsWith(`.${tableName}`),
  );
  if (!key) throw new Error(`La tabla ${tableName} no aparece en el esquema REST de Supabase`);
  return schemas[key];
}

function pickColumn(properties, candidates) {
  return candidates.find((candidate) => Object.prototype.hasOwnProperty.call(properties, candidate)) || null;
}

async function loadActiveProducts() {
  const products = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const rows = await supabaseRequest(
      `productos?select=id,categoria,subcategoria&activo=eq.true&order=id.asc`,
      {
        method: "GET",
        prefer: "return=representation",
        headers: {
          Range: `${from}-${from + pageSize - 1}`,
          "Range-Unit": "items",
        },
      },
    );

    if (!Array.isArray(rows)) break;
    products.push(...rows);
    if (rows.length < pageSize) break;
  }

  return products;
}

function buildTaxonomy(products) {
  const categories = new Map();

  products.forEach((product) => {
    const categoryName = toStr(product.categoria) || "Otros";
    const subcategoryName = toStr(product.subcategoria) || "Otros";

    if (!categories.has(categoryName)) categories.set(categoryName, new Set());
    categories.get(categoryName).add(subcategoryName);
  });

  return [...categories.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([name, subcategories], categoryIndex) => ({
      name,
      slug: slugify(name),
      order: categoryIndex + 1,
      subcategories: [...subcategories]
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((subcategory, subcategoryIndex) => ({
          name: subcategory,
          slug: `${slugify(name)}-${slugify(subcategory)}`,
          order: subcategoryIndex + 1,
        })),
    }));
}

function buildCategoryRecord(category, schema) {
  const properties = schema?.properties || {};
  const nameColumn = pickColumn(properties, ["nombre", "name", "categoria", "titulo", "descripcion"]);
  const slugColumn = pickColumn(properties, ["slug", "codigo", "code", "clave"]);
  const activeColumn = pickColumn(properties, ["activo", "active", "habilitado"]);
  const orderColumn = pickColumn(properties, ["orden", "posicion", "position", "prioridad"]);

  if (!nameColumn) {
    throw new Error("No se encontró una columna de nombre compatible en public.categorias");
  }

  const record = { [nameColumn]: category.name };
  if (slugColumn) record[slugColumn] = category.slug;
  if (activeColumn) record[activeColumn] = true;
  if (orderColumn) record[orderColumn] = category.order;
  return { record, nameColumn };
}

function buildSubcategoryRecord(category, subcategory, schema, categoryRow, categorySchema) {
  const properties = schema?.properties || {};
  const categoryProperties = categorySchema?.properties || {};
  const nameColumn = pickColumn(properties, ["nombre", "name", "subcategoria", "titulo", "descripcion"]);
  const slugColumn = pickColumn(properties, ["slug", "codigo", "code", "clave"]);
  const activeColumn = pickColumn(properties, ["activo", "active", "habilitado"]);
  const orderColumn = pickColumn(properties, ["orden", "posicion", "position", "prioridad"]);
  const categoryIdColumn = pickColumn(properties, ["categoria_id", "id_categoria", "category_id"]);
  const categoryTextColumn = pickColumn(properties, ["categoria", "categoria_nombre", "category"]);
  const categoryIdSource = pickColumn(categoryProperties, ["id", "categoria_id", "category_id"]);

  if (!nameColumn) {
    throw new Error("No se encontró una columna de nombre compatible en public.subcategorias");
  }

  const record = { [nameColumn]: subcategory.name };
  if (slugColumn) record[slugColumn] = subcategory.slug;
  if (activeColumn) record[activeColumn] = true;
  if (orderColumn) record[orderColumn] = subcategory.order;

  if (categoryIdColumn) {
    if (!categoryIdSource || categoryRow?.[categoryIdSource] == null) {
      throw new Error("No se pudo resolver el ID de categoría para cargar subcategorías");
    }
    record[categoryIdColumn] = categoryRow[categoryIdSource];
  } else if (categoryTextColumn) {
    record[categoryTextColumn] = category.name;
  }

  return { record, nameColumn };
}

async function replaceTaxonomy(taxonomy, categorySchema, subcategorySchema) {
  const categoryPreview = buildCategoryRecord(taxonomy[0] || { name: "Otros", slug: "otros", order: 1 }, categorySchema);
  const subcategoryPreview = buildSubcategoryRecord(
    taxonomy[0] || { name: "Otros" },
    taxonomy[0]?.subcategories?.[0] || { name: "Otros", slug: "otros-otros", order: 1 },
    subcategorySchema,
    { id: 1 },
    categorySchema,
  );

  await supabaseRequest(
    `subcategorias?${encodeURIComponent(subcategoryPreview.nameColumn)}=not.is.null`,
    { method: "DELETE" },
  );
  await supabaseRequest(
    `categorias?${encodeURIComponent(categoryPreview.nameColumn)}=not.is.null`,
    { method: "DELETE" },
  );

  const categoryRecords = taxonomy.map((category) => buildCategoryRecord(category, categorySchema).record);
  const insertedCategories = await supabaseRequest("categorias", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify(categoryRecords),
  });

  if (!Array.isArray(insertedCategories) || insertedCategories.length !== categoryRecords.length) {
    throw new Error("Supabase no devolvió todas las categorías insertadas");
  }

  const categoryNameColumn = buildCategoryRecord(taxonomy[0], categorySchema).nameColumn;
  const categoryRowsByName = new Map(
    insertedCategories.map((row) => [toStr(row[categoryNameColumn]), row]),
  );

  const subcategoryRecords = [];
  taxonomy.forEach((category) => {
    const categoryRow = categoryRowsByName.get(category.name);
    category.subcategories.forEach((subcategory) => {
      subcategoryRecords.push(
        buildSubcategoryRecord(
          category,
          subcategory,
          subcategorySchema,
          categoryRow,
          categorySchema,
        ).record,
      );
    });
  });

  if (subcategoryRecords.length) {
    await supabaseRequest("subcategorias", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify(subcategoryRecords),
    });
  }

  return {
    categorias: categoryRecords.length,
    subcategorias: subcategoryRecords.length,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  if (req.method === "GET" && toStr(req.query?.schema) === "1") {
    try {
      const spec = await loadOpenApi();
      const simplify = (name) => {
        const schema = resolveSchema(spec, name);
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

  const expectedToken = toStr(process.env.SYNC_TOKEN);
  const receivedToken = toStr(req.query?.token || req.headers["x-sync-token"]);
  if (!expectedToken) {
    return sendJson(res, 500, { ok: false, error: "Falta configurar SYNC_TOKEN en Vercel" });
  }
  if (receivedToken !== expectedToken) {
    return sendJson(res, 401, { ok: false, error: "Token de sincronización incorrecto" });
  }

  try {
    const [products, spec] = await Promise.all([loadActiveProducts(), loadOpenApi()]);
    const taxonomy = buildTaxonomy(products);
    const categorySchema = resolveSchema(spec, "categorias");
    const subcategorySchema = resolveSchema(spec, "subcategorias");
    const result = await replaceTaxonomy(taxonomy, categorySchema, subcategorySchema);

    return sendJson(res, 200, {
      ok: true,
      source: "productos",
      destination: "supabase_taxonomia",
      productos_activos: products.length,
      ...result,
    });
  } catch (error) {
    console.error("[sync-taxonomy]", String(error?.message || error));
    return sendJson(res, 500, {
      ok: false,
      error: "No se pudieron sincronizar categorías y subcategorías",
      message: String(error?.message || error),
    });
  }
}
