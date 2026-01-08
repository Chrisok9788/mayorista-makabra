/*
 * Módulo para generar y enviar el mensaje de WhatsApp a partir
 * del contenido del carrito. El mensaje se formatea para que
 * sea claro, ordenado y profesional, utilizando viñetas y
 * mostrando el total de ítems.
 */

/**
 * Construye un mensaje de WhatsApp a partir del carrito y la
 * lista de productos. Devuelve el texto URI-encoded listo para
 * incluir en el enlace de WhatsApp.
 *
 * @param {Object} cart Objeto del carrito {id: qty}.
 * @param {Array} products Lista completa de productos.
 * @returns {string} Mensaje codificado para WhatsApp.
 */
export function buildWhatsappMessage(cart, products) {
  const lines = [];
  // Encabezado con emoji de carrito
  lines.push('🛒 PEDIDO MAYORISTA MAKABRA');
  lines.push('');
  let total = 0;
  // Recorremos cada ítem del carrito
  Object.entries(cart).forEach(([id, qty]) => {
    const product = products.find((p) => p.id === id);
    if (!product) return;
    total += qty;
    let line = `• ${product.nombre}`;
    if (product.presentacion) line += ` (${product.presentacion})`;
    if (product.marca) line += ` [${product.marca}]`;
    line += ` x ${qty}`;
    lines.push(line);
  });
  lines.push('');
  lines.push(`📍 Total de ítems: ${total}`);
  // Unimos las líneas con saltos de línea y codificamos
  return encodeURIComponent(lines.join('\n'));
}

/**
 * Abre una nueva pestaña o ventana con el enlace de WhatsApp y
 * el mensaje generado. Utiliza el número de contacto fijo de
 * Makabra.
 *
 * @param {Object} cart Objeto de carrito.
 * @param {Array} products Lista completa de productos.
 */
export function sendOrder(cart, products) {
  const message = buildWhatsappMessage(cart, products);
  const url = `https://wa.me/59896405927?text=${message}`;
  window.open(url, '_blank');
}