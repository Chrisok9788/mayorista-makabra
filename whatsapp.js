/*
 * Módulo para construir y enviar el pedido por WhatsApp.
 * Genera un texto con los productos del carrito y abre wa.me
 * con el mensaje prellenado.
 */

export function sendOrder(cart, products) {
  // Número WhatsApp (sin +). Ajustalo si querés.
  const phone = "59896405927";

  // Ayudante: buscar producto por id
  const findProduct = (id) => products.find((p) => p.id === id);

  let lines = [];
  let total = 0;

  lines.push("Hola Makabra, quiero hacer un pedido:");
  lines.push("");

  // Construimos líneas del pedido
  for (const productId of Object.keys(cart)) {
    const qty = cart[productId];
    const product = findProduct(productId);

    if (!product) continue;

    const nameParts = [
      product.nombre || "Producto",
      product.marca ? `(${product.marca})` : "",
      product.presentacion ? `- ${product.presentacion}` : "",
    ].filter(Boolean);

    const title = nameParts.join(" ").replace(/\s+/g, " ").trim();

    const price = typeof product.precio === "number" ? product.precio : 0;

    if (price > 0) {
      const lineSubtotal = price * qty;
      total += lineSubtotal;

      lines.push(
        `• ${title} x${qty} — $${price.toLocaleString("es-UY")} c/u = $${lineSubtotal.toLocaleString("es-UY")}`
      );
    } else {
      lines.push(`• ${title} x${qty} — CONSULTAR`);
    }
  }

  lines.push("");
  lines.push(`TOTAL: $${total.toLocaleString("es-UY")}`);
  lines.push("");
  lines.push("Gracias.");

  const message = encodeURIComponent(lines.join("\n"));
  const url = `https://wa.me/${phone}?text=${message}`;

  window.open(url, "_blank", "noopener");
}
