export const config = { runtime: "nodejs" };

const PAGE_SIZE = 1000;
const DELETE_CHUNK_SIZE = 150;

function toStr(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return toStr(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
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

async function loadActiveProducts() {
  const products = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const rows = await supabaseRequest(
      "productos?select=id,categoria,subcategoria&activo=eq.true&order=id.asc",
      {
        method: "GET",
        prefer: "return=representation",
        headers: {
          Range: `${from}-${from + PAGE_SIZE - 1}`,
          "Range-Unit": "items",
        },
      },
    );

    if (!Array.isArray(rows)) break;
    products.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return products;
}

async function loadCategories() {
  const rows = await supabaseRequest(
    "categorias?select=id,nombre,orden,activa&order=id.asc",
    { method: "GET", prefer: "return=representation" },
  );
  return Array.isArray(rows) ? rows : [];
}

async function loadSubcategories() {
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await supabaseRequest(
      "subcategorias?select=id,categoria_id,nombre,orden,activa&order=id.asc",
      {
        method: "GET",
        prefer: "return=representation",
        headers: {
          Range: `${from}-${from + PAGE_SIZE - 1}`,
          "Range-Unit": "items",
        },
      },
    );

    if (!Array.isArray(page)) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

function buildTaxonomy(products) {
  const categories = new Map();

  products.forEach((product) => {
    const categoryName = toStr(product.categoria) || "Otros";
    const subcategoryName = toStr(product.subcategoria) || "Otros";
    const categoryKey = normalizeKey(categoryName);
    const subcategoryKey = normalizeKey(subcategoryName);

    if (!categories.has(categoryKey)) {
      categories.set(categoryKey, {
        key: categoryKey,
        nombre: categoryName,
        subcategorias: new Map(),
      });
    }

    const category = categories.get(categoryKey);
    if (!category.subcategorias.has(subcategoryKey)) {
      category.subcategorias.set(subcategoryKey, {
        key: subcategoryKey,
        nombre: subcategoryName,
      });
    }
  });

  return [...categories.values()]
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .map((category, categoryIndex) => ({
      ...category,
      orden: categoryIndex + 1,
      subcategorias: [...category.subcategorias.values()]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        .map((subcategory, subcategoryIndex) => ({
          ...subcategory,
          orden: subcategoryIndex + 1,
        })),
    }));
}

function groupRows(rows, keyBuilder) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = keyBuilder(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  return grouped;
}

async function patchCategory(id, category) {
  await supabaseRequest(`categorias?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      nombre: category.nombre,
      orden: category.orden,
      activa: true,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function patchSubcategory(id, subcategory) {
  await supabaseRequest(`subcategorias?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      nombre: subcategory.nombre,
      orden: subcategory.orden,
      activa: true,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function deleteRows(table, ids) {
  let removed = 0;

  for (let index = 0; index < ids.length; index += DELETE_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + DELETE_CHUNK_SIZE);
    if (!chunk.length) continue;

    await supabaseRequest(`${table}?id=in.(${chunk.map((id) => encodeURIComponent(id)).join(",")})`, {
      method: "DELETE",
    });
    removed += chunk.length;
  }

  return removed;
}

async function synchronizeTaxonomy(taxonomy) {
  const [existingCategories, existingSubcategories] = await Promise.all([
    loadCategories(),
    loadSubcategories(),
  ]);

  const categoriesByKey = groupRows(existingCategories, (row) => normalizeKey(row.nombre));
  const selectedCategoryIds = new Set();
  const categoryRowsByKey = new Map();
  const categoriesToInsert = [];
  let categoriesUpdated = 0;

  for (const category of taxonomy) {
    const matches = categoriesByKey.get(category.key) || [];
    const existing = matches[0] || null;

    if (!existing) {
      categoriesToInsert.push({
        nombre: category.nombre,
        orden: category.orden,
        activa: true,
      });
      continue;
    }

    selectedCategoryIds.add(Number(existing.id));
    categoryRowsByKey.set(category.key, existing);

    if (
      toStr(existing.nombre) !== category.nombre ||
      Number(existing.orden) !== category.orden ||
      existing.activa !== true
    ) {
      await patchCategory(existing.id, category);
      categoriesUpdated += 1;
      categoryRowsByKey.set(category.key, {
        ...existing,
        nombre: category.nombre,
        orden: category.orden,
        activa: true,
      });
    }
  }

  let insertedCategories = [];
  if (categoriesToInsert.length) {
    insertedCategories = await supabaseRequest("categorias", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify(categoriesToInsert),
    });

    if (!Array.isArray(insertedCategories) || insertedCategories.length !== categoriesToInsert.length) {
      throw new Error("Supabase no devolvió todas las categorías insertadas");
    }

    insertedCategories.forEach((row) => {
      const key = normalizeKey(row.nombre);
      selectedCategoryIds.add(Number(row.id));
      categoryRowsByKey.set(key, row);
    });
  }

  for (const category of taxonomy) {
    if (!categoryRowsByKey.has(category.key)) {
      throw new Error(`No se pudo resolver la categoría ${category.nombre}`);
    }
  }

  const subcategoriesByKey = groupRows(
    existingSubcategories,
    (row) => `${Number(row.categoria_id)}|${normalizeKey(row.nombre)}`,
  );
  const selectedSubcategoryIds = new Set();
  const subcategoriesToInsert = [];
  let subcategoriesUpdated = 0;

  for (const category of taxonomy) {
    const categoryRow = categoryRowsByKey.get(category.key);
    const categoryId = Number(categoryRow.id);

    for (const subcategory of category.subcategorias) {
      const compositeKey = `${categoryId}|${subcategory.key}`;
      const matches = subcategoriesByKey.get(compositeKey) || [];
      const existing = matches[0] || null;

      if (!existing) {
        subcategoriesToInsert.push({
          categoria_id: categoryId,
          nombre: subcategory.nombre,
          orden: subcategory.orden,
          activa: true,
        });
        continue;
      }

      selectedSubcategoryIds.add(Number(existing.id));
      if (
        toStr(existing.nombre) !== subcategory.nombre ||
        Number(existing.orden) !== subcategory.orden ||
        existing.activa !== true
      ) {
        await patchSubcategory(existing.id, subcategory);
        subcategoriesUpdated += 1;
      }
    }
  }

  let insertedSubcategories = [];
  if (subcategoriesToInsert.length) {
    insertedSubcategories = await supabaseRequest("subcategorias", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify(subcategoriesToInsert),
    });

    if (!Array.isArray(insertedSubcategories) || insertedSubcategories.length !== subcategoriesToInsert.length) {
      throw new Error("Supabase no devolvió todas las subcategorías insertadas");
    }

    insertedSubcategories.forEach((row) => selectedSubcategoryIds.add(Number(row.id)));
  }

  const staleSubcategoryIds = existingSubcategories
    .map((row) => Number(row.id))
    .filter((id) => !selectedSubcategoryIds.has(id));

  const staleCategoryIds = existingCategories
    .map((row) => Number(row.id))
    .filter((id) => !selectedCategoryIds.has(id));

  const subcategoriesRemoved = await deleteRows("subcategorias", staleSubcategoryIds);
  const categoriesRemoved = await deleteRows("categorias", staleCategoryIds);

  return {
    categorias: taxonomy.length,
    categorias_insertadas: insertedCategories.length,
    categorias_actualizadas: categoriesUpdated,
    categorias_eliminadas: categoriesRemoved,
    subcategorias: taxonomy.reduce((total, category) => total + category.subcategorias.length, 0),
    subcategorias_insertadas: insertedSubcategories.length,
    subcategorias_actualizadas: subcategoriesUpdated,
    subcategorias_eliminadas: subcategoriesRemoved,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
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
    const products = await loadActiveProducts();
    if (!products.length) {
      throw new Error("No hay productos activos; se canceló la sincronización para proteger las tablas");
    }

    const taxonomy = buildTaxonomy(products);
    const result = await synchronizeTaxonomy(taxonomy);

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
