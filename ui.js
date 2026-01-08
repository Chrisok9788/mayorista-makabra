/*
 * Módulo de interfaz de usuario para el sitio del mayorista.
 * Contiene funciones para renderizar productos, el carrito,
 * actualizar contadores y filtrar resultados. Estas
 * funciones son independientes de la lógica de negocio y
 * permiten reutilizar comportamientos en distintos lugares.
 */

/**
 * Renderiza la lista de productos en un contenedor, creando una
 * tarjeta por cada producto. Se ofrece un manejador para
 * interceptar clics en el botón “Agregar”.
 *
 * @param {Array} list Lista de productos a mostrar.
 * @param {HTMLElement} container Elemento donde se insertan las tarjetas.
 * @param {Function} addHandler Función llamada con el ID del producto cuando se hace clic en “Agregar”.
 */
export function renderProducts(list, container, addHandler) {
  container.innerHTML = '';
  if (!list.length) {
    container.innerHTML = '<p>No se encontraron productos.</p>';
    return;
  }
  list.forEach((product) => {
    // Contenedor de la tarjeta
    const card = document.createElement('div');
    card.className = 'product-card';

    // Determinar la etiqueta/badge según el estado del producto
    let badgeLabel = '';
    let badgeClass = '';
    // Si existe una propiedad de stock y es cero o menor, mostramos "SIN STOCK"
    if (typeof product.stock !== 'undefined' && product.stock <= 0) {
      badgeLabel = 'SIN STOCK';
      badgeClass = 'sin-stock';
    } else if (product.precio != null && product.precio > 0) {
      // Si hay precio mayor a 0 consideramos que hay una oferta
      badgeLabel = 'OFERTA';
      badgeClass = 'oferta';
    } else {
      // Cuando no hay precio definido o es 0, pedimos consultar
      badgeLabel = 'CONSULTAR';
      badgeClass = 'consultar';
    }
    // Crear y añadir el badge si corresponde
    if (badgeLabel) {
      const badgeEl = document.createElement('span');
      badgeEl.className = `badge ${badgeClass}`;
      badgeEl.textContent = badgeLabel;
      card.appendChild(badgeEl);
    }

    // Imagen del producto
    const img = document.createElement('img');
    img.className = 'product-image';
    // Calculamos la ruta base de manera segura. Si import.meta.env.BASE_URL
    // no existe (por ejemplo, al abrir el HTML directamente sin Vite),
    // utilizamos './'.
    const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL)
      ? import.meta.env.BASE_URL
      : './';
    // Si no hay imagen definida, usar el placeholder
    img.src = product.imagen || `${BASE}placeholder.png`;
    img.alt = product.nombre;
    card.appendChild(img);

    // Contenedor de contenido textual
    const content = document.createElement('div');
    content.className = 'product-content';

    // Nombre del producto
    const title = document.createElement('h3');
    title.textContent = product.nombre;
    content.appendChild(title);

    // Información adicional: marca y presentación (si existen)
    const meta = document.createElement('div');
    meta.className = 'meta';
    if (product.marca) {
      const spanMarca = document.createElement('span');
      spanMarca.textContent = product.marca;
      meta.appendChild(spanMarca);
    }
    if (product.presentacion) {
      if (meta.childElementCount > 0) {
        // Separador
        const sep = document.createElement('span');
        sep.textContent = ' · ';
        meta.appendChild(sep);
      }
      const spanPres = document.createElement('span');
      spanPres.textContent = product.presentacion;
      meta.appendChild(spanPres);
    }
    if (product.categoria && meta.childElementCount === 0) {
      // Si no hay marca ni presentación, mostrar la categoría
      const cat = document.createElement('span');
      cat.textContent = product.categoria;
      meta.appendChild(cat);
    }
    if (meta.childElementCount > 0) {
      content.appendChild(meta);
    }

    // Precio o mensaje de consulta
    const precio = document.createElement('p');
    precio.className = 'price';
    if (product.stock !== undefined && product.stock <= 0) {
      precio.textContent = 'Sin stock';
    } else if (product.precio != null && product.precio > 0) {
      precio.textContent = `$ ${product.precio}`;
    } else {
      precio.textContent = 'Consultar';
    }
    content.appendChild(precio);

    // Botón para agregar al carrito
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.textContent = 'Agregar al carrito';
    addBtn.addEventListener('click', () => {
      addHandler(product.id);
    });
    content.appendChild(addBtn);

    card.appendChild(content);
    container.appendChild(card);
  });
}

/**
 * Renderiza los ítems del carrito en un contenedor. Cada ítem
 * incluye botones para incrementar, decrementar y eliminar,
 * así como un input para modificar la cantidad manualmente.
 *
 * @param {Array} products Lista completa de productos (para buscar datos por id).
 * @param {Object} cart Objeto de carrito {id: qty}.
 * @param {HTMLElement} container Contenedor donde renderizar los ítems.
 * @param {Function} updateHandler Función llamada con (id, qty) para actualizar la cantidad de un ítem.
 * @param {Function} removeHandler Función llamada con (id) para eliminar un ítem.
 */
export function renderCart(products, cart, container, updateHandler, removeHandler) {
  container.innerHTML = '';
  const entries = Object.entries(cart);
  if (!entries.length) {
    container.innerHTML = '<p>Tu carrito está vacío.</p>';
    return;
  }
  entries.forEach(([productId, qty]) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const item = document.createElement('div');
    item.className = 'cart-item';

    const nameDiv = document.createElement('div');
    nameDiv.className = 'cart-item-name';
    nameDiv.textContent = `${product.nombre}${product.presentacion ? ' (' + product.presentacion + ')' : ''}${product.marca ? ' [' + product.marca + ']' : ''}`;
    item.appendChild(nameDiv);

    const controls = document.createElement('div');
    controls.className = 'cart-item-controls';

    const minusBtn = document.createElement('button');
    minusBtn.textContent = '−';
    minusBtn.addEventListener('click', () => {
      const newQty = qty - 1;
      updateHandler(productId, newQty);
    });
    controls.appendChild(minusBtn);

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.value = qty;
    qtyInput.addEventListener('change', (e) => {
      let value = parseInt(e.target.value, 10);
      if (isNaN(value) || value < 1) {
        value = 1;
      }
      updateHandler(productId, value);
    });
    controls.appendChild(qtyInput);

    const plusBtn = document.createElement('button');
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => {
      updateHandler(productId, qty + 1);
    });
    controls.appendChild(plusBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✖';
    removeBtn.addEventListener('click', () => {
      removeHandler(productId);
    });
    controls.appendChild(removeBtn);

    item.appendChild(controls);
    container.appendChild(item);
  });
}

/**
 * Actualiza el texto del contador de items del carrito.
 *
 * @param {HTMLElement} countEl Elemento span donde mostrar el número.
 * @param {number} count Cantidad a mostrar.
 */
export function updateCartCount(countEl, count) {
  countEl.textContent = count;
}

/**
 * Llena un elemento select con las categorías únicas presentes en
 * la lista de productos. Las categorías se ordenan
 * alfabéticamente.
 *
 * @param {Array} products Lista de productos.
 * @param {HTMLSelectElement} select El select que se va a poblar.
 */
export function populateCategories(products, select) {
  const categories = Array.from(new Set(products.map((p) => p.categoria))).sort();
  categories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

/**
 * Devuelve una nueva lista filtrada de productos según una
 * categoría y un término de búsqueda. El término se busca
 * dentro del nombre, marca, categoría y tags del producto,
 * ignorando mayúsculas y minúsculas.
 *
 * @param {Array} products Lista completa de productos.
 * @param {string} category Valor del select de categoría (puede estar vacío).
 * @param {string} searchTerm Texto ingresado por el usuario en el buscador.
 * @returns {Array} Lista filtrada de productos.
 */
export function filterProducts(products, category, searchTerm) {
  let filtered = products;
  if (category) {
    filtered = filtered.filter((p) => p.categoria === category);
  }
  if (searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    filtered = filtered.filter((p) => {
      const terms = [p.nombre, p.marca || '', p.categoria, (p.tags || []).join(' ')].join(' ').toLowerCase();
      return terms.includes(term);
    });
  }
  return filtered;
}
