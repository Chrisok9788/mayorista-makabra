/*
 * Módulo de interfaz de usuario para el sitio del mayorista.
 * Contiene funciones para renderizar productos, el carrito,
 * actualizar contadores y filtrar resultados.
 * Totalmente compatible con GitHub Pages.
 */

/**
 * Renderiza la lista de productos en un contenedor.
 *
 * @param {Array} list Lista de productos a mostrar.
 * @param {HTMLElement} container Elemento donde se insertan las tarjetas.
 * @param {Function} addHandler Función llamada con el ID del producto al hacer clic en “Agregar”.
 */
export function renderProducts(list, container, addHandler) {
  container.innerHTML = '';

  if (!list.length) {
    container.innerHTML = '<p>No se encontraron productos.</p>';
    return;
  }

  list.forEach((product) => {
    const card = document.createElement('div');
    card.className = 'product-card';

    /* ===== BADGE ===== */
    let badgeLabel = '';
    let badgeClass = '';

    if (typeof product.stock !== 'undefined' && product.stock <= 0) {
      badgeLabel = 'SIN STOCK';
      badgeClass = 'sin-stock';
    } else if (product.oferta === true) {
      badgeLabel = 'OFERTA';
      badgeClass = 'oferta';
    } else if (product.precio == null || product.precio <= 0) {
      badgeLabel = 'CONSULTAR';
      badgeClass = 'consultar';
    }

    if (badgeLabel) {
      const badge = document.createElement('span');
      badge.className = `badge ${badgeClass}`;
      badge.textContent = badgeLabel;
      card.appendChild(badge);
    }

    /* ===== IMAGEN ===== */
    const img = document.createElement('img');
    img.className = 'product-image';

    const BASE =
      typeof import.meta !== 'undefined' &&
      import.meta.env &&
      import.meta.env.BASE_URL
        ? import.meta.env.BASE_URL
        : './';

    img.src = product.imagen || `${BASE}placeholder.png`;
    img.alt = product.nombre;
    card.appendChild(img);

    /* ===== CONTENIDO ===== */
    const content = document.createElement('div');
    content.className = 'product-content';

    const title = document.createElement('h3');
    title.textContent = product.nombre;
    content.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'meta';

    if (product.marca) {
      meta.appendChild(document.createTextNode(product.marca));
    }

    if (product.presentacion) {
      if (meta.childNodes.length) meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(document.createTextNode(product.presentacion));
    }

    if (!meta.childNodes.length && product.categoria) {
      meta.appendChild(document.createTextNode(product.categoria));
    }

    if (meta.childNodes.length) content.appendChild(meta);

    /* ===== PRECIO ===== */
    const price = document.createElement('p');
    price.className = 'price';

    if (product.stock !== undefined && product.stock <= 0) {
      price.textContent = 'Sin stock';
    } else if (product.precio != null && product.precio > 0) {
      price.textContent = `$ ${product.precio}`;
    } else {
      price.textContent = 'Consultar';
    }

    content.appendChild(price);

    /* ===== BOTÓN ===== */
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Agregar al carrito';
    btn.addEventListener('click', () => addHandler(product.id));

    content.appendChild(btn);

    card.appendChild(content);
    container.appendChild(card);
  });
}

/**
 * Renderiza el carrusel de OFERTAS.
 *
 * Reglas:
 * - Oferta = product.oferta === true
 * - Si stock existe y <=0, no se muestra en ofertas
 * - Si no hay ofertas, muestra mensaje en el frame
 *
 * @param {Array} products Lista completa de productos
 * @param {HTMLElement} frameEl Contenedor .offers-frame (para mensaje vacío)
 * @param {HTMLElement} trackEl Contenedor .offers-track (donde van las tarjetas)
 * @param {Function} onClick Callback opcional al clickear una oferta (recibe product.id)
 */
export function renderOffersCarousel(products, frameEl, trackEl, onClick) {
  if (!frameEl || !trackEl) return;

  // Limpia track y mensaje previo
  trackEl.innerHTML = '';
  const prevEmpty = frameEl.querySelector('.offers-empty');
  if (prevEmpty) prevEmpty.remove();

  const offers = (products || []).filter((p) => {
    const hasStockInfo = typeof p.stock !== 'undefined';
    const inStock = !hasStockInfo || p.stock > 0;
    return p.oferta === true && inStock;
  });

  if (offers.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'offers-empty';
    empty.textContent = 'No hay ofertas cargadas.';
    frameEl.appendChild(empty);
    return;
  }

  // Armado de tarjetas compatibles con tu CSS actual (.offer-card, .offer-img, etc.)
  const cardsHtml = offers
    .map((p) => {
      const name = p.nombre || 'Producto';
      const img = p.imagen || '';
      const price =
        p.precio != null && p.precio > 0 ? `$ ${p.precio}` : 'Consultar';

      return `
        <div class="offer-card" data-id="${p.id ?? ''}">
          ${
            img
              ? `<img class="offer-img" src="${img}" alt="${name}">`
              : `<div class="offer-img"></div>`
          }
          <div class="offer-body">
            <p class="offer-title">${name}</p>
            <div class="offer-price">${price}</div>
          </div>
        </div>
      `;
    })
    .join('');

  // Inserta 1 vez y duplica para que la animación -50% no deje el track vacío
  trackEl.innerHTML = cardsHtml + cardsHtml;

  // Click handler opcional
  if (typeof onClick === 'function') {
    trackEl.querySelectorAll('.offer-card').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        if (id != null && id !== '') onClick(id);
      });
    });
  }
}

/**
 * Renderiza el carrito de compras.
 *
 * @param {Array} products Lista completa de productos.
 * @param {Object} cart Objeto carrito {id: cantidad}.
 * @param {HTMLElement} container Contenedor del carrito.
 * @param {Function} updateHandler Función (id, qty).
 * @param {Function} removeHandler Función (id).
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

    const name = document.createElement('div');
    name.className = 'cart-item-name';
    name.textContent = product.nombre;
    item.appendChild(name);

    const controls = document.createElement('div');
    controls.className = 'cart-item-controls';

    const minus = document.createElement('button');
    minus.textContent = '−';
    minus.onclick = () => updateHandler(productId, qty - 1);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.value = qty;
    input.onchange = (e) => {
      const v = parseInt(e.target.value, 10);
      updateHandler(productId, isNaN(v) ? 1 : v);
    };

    const plus = document.createElement('button');
    plus.textContent = '+';
    plus.onclick = () => updateHandler(productId, qty + 1);

    const remove = document.createElement('button');
    remove.textContent = '✖';
    remove.onclick = () => removeHandler(productId);

    controls.append(minus, input, plus, remove);
    item.appendChild(controls);
    container.appendChild(item);
  });
}

/**
 * Actualiza el contador del carrito.
 */
export function updateCartCount(countEl, count) {
  countEl.textContent = count;
}

/**
 * Carga categorías únicas en el select.
 */
export function populateCategories(products, select) {
  const categories = Array.from(
    new Set(products.map((p) => p.categoria).filter(Boolean))
  ).sort();

  categories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
}

/**
 * Filtra productos por categoría y texto.
 */
export function filterProducts(products, category, searchTerm) {
  let result = products;

  if (category) {
    result = result.filter((p) => p.categoria === category);
  }

  if (searchTerm) {
    const term = searchTerm.toLowerCase().trim();
    result = result.filter((p) => {
      const text = [
        p.nombre,
        p.marca || '',
        p.categoria || '',
        (p.tags || []).join(' ')
      ]
        .join(' ')
        .toLowerCase();
      return text.includes(term);
    });
  }

  return result;
}

/**
 * Renderiza un acordeón de categorías y subcategorías.
 *
 * Construye la estructura de categorías (p.categoria) y subcategorías (p.subcategoria)
 * y la inserta en el elemento #categoryAccordion. Cada ítem muestra un contador
 * con la cantidad de productos. Al hacer clic en una subcategoría se llama
 * al callback onSelect con la lista filtrada de productos.
 *
 * @param {Array} products Lista completa de productos con subcategoria.
 * @param {Function} onSelect Callback opcional (lista filtrada).
 */
export function renderCategoryAccordion(products, onSelect) {
  const accordion = document.getElementById('categoryAccordion');
  if (!accordion) return;
  accordion.innerHTML = '';

  // Agrupar categorías → subcategorías → conteo
  const map = new Map();
  for (const p of products) {
    const cat = (p.categoria || 'Otros').trim();
    const sub = (p.subcategoria || 'Otros').trim();
    if (!map.has(cat)) map.set(cat, new Map());
    const subMap = map.get(cat);
    subMap.set(sub, (subMap.get(sub) || 0) + 1);
  }

  // Ordenar categorías alfabéticamente
  const cats = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
  cats.forEach((cat) => {
    const subMap = map.get(cat);
    const subs = Array.from(subMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    const item = document.createElement('div');
    item.className = 'accordion-item';

    const btn = document.createElement('button');
    btn.className = 'accordion-btn';
    btn.type = 'button';
    btn.innerHTML = `<span>${cat}</span><span class="chev">▾</span>`;

    const body = document.createElement('div');
    body.className = 'accordion-body';

    // "Ver todo" dentro de la categoría
    const totalCount = Array.from(subMap.values()).reduce((a, b) => a + b, 0);
    const all = document.createElement('div');
    all.className = 'subcat';
    all.innerHTML = `<span>Ver todo</span><small>${totalCount}</small>`;
    all.onclick = () => {
      if (typeof onSelect === 'function') {
        const filtered = products.filter((p) => (p.categoria || '').trim() === cat);
        onSelect(filtered);
      }
    };
    body.appendChild(all);

    // Subcategorías
    subs.forEach(([sub, count]) => {
      const row = document.createElement('div');
      row.className = 'subcat';
      row.innerHTML = `<span>${sub}</span><small>${count}</small>`;
      row.onclick = () => {
        if (typeof onSelect === 'function') {
          const filtered = products.filter(
            (p) => (p.categoria || '').trim() === cat && (p.subcategoria || '').trim() === sub
          );
          onSelect(filtered);
        }
      };
      body.appendChild(row);
    });

    btn.onclick = () => {
      body.classList.toggle('open');
    };

    item.appendChild(btn);
    item.appendChild(body);
    accordion.appendChild(item);
  });
}
