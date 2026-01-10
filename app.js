 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/app.js b/app.js
index c789b01ef7c27bc6986510ef9777061e7e8e060d..0855ae9aa7b6eda0a4f7c61eb34139ea2b120d8e 100644
--- a/app.js
+++ b/app.js
@@ -1,55 +1,57 @@
 /*
  * Punto de entrada de la aplicación. Importa los distintos
  * módulos (datos, carrito, UI, WhatsApp) y coordina su
  * funcionamiento. Gestiona eventos y actualiza la interfaz
  * cuando el usuario interactúa.
  */
 
 import { fetchProducts } from "./data.js";
 import {
   loadCart,
   getCart,
   addItem,
   updateItem,
   removeItem,
   clearCart,
   totalItems,
   totalAmount,
 } from "./cart.js";
 import {
   renderProducts,
   renderCart,
   updateCartCount,
   populateCategories,
   filterProducts,
+  renderCategoryAccordion,
   renderOffersCarousel, // ✅ Carrusel de ofertas
 } from "./ui.js";
 import { sendOrder } from "./whatsapp.js";
 
 // Lista de productos cargada desde el JSON
 let products = [];
+let baseProducts = [];
 
 /**
  * Lleva al catálogo (HTML actual: id="catalogue") y muestra el producto tocado en ofertas.
  * Esto NO rompe el sitio porque respeta tus anclas existentes.
  */
 function goToCatalogAndShowProduct(productId) {
   // ✅ Usamos el id real existente en tu HTML
   const catalogSection = document.getElementById("catalogue");
   if (catalogSection) {
     catalogSection.scrollIntoView({ behavior: "smooth", block: "start" });
   }
 
   const prod = products.find((p) => p.id === productId);
   if (!prod) return;
 
   // Mostrar SOLO el producto seleccionado en el catálogo
   renderProducts([prod], document.getElementById("products-container"), handleAdd);
 
   // Limpiar filtros visualmente (evita confusión)
   const searchInput = document.getElementById("search-input");
   if (searchInput) searchInput.value = "";
 
   const categorySelect = document.getElementById("category-filter");
   if (categorySelect) categorySelect.value = "";
 }
@@ -95,72 +97,87 @@ function handleAdd(productId) {
  * Manejador para actualizar la cantidad de un producto en el carrito.
  */
 function handleUpdate(productId, qty) {
   updateItem(productId, qty);
   rerenderCartUI();
 }
 
 /**
  * Manejador para eliminar un producto del carrito.
  */
 function handleRemove(productId) {
   removeItem(productId);
   rerenderCartUI();
 }
 
 /**
  * Aplica filtrado por categoría y búsqueda y vuelve a renderizar.
  */
 function applySearchAndFilter() {
   const searchInput = document.getElementById("search-input");
   const categorySelect = document.getElementById("category-filter");
 
   const searchTerm = searchInput ? searchInput.value : "";
   const selectedCategory = categorySelect ? categorySelect.value : "";
 
-  const filtered = filterProducts(products, selectedCategory, searchTerm);
+  let filtered = baseProducts;
+
+  if (selectedCategory) {
+    filtered = filtered.filter((product) => product.categoria === selectedCategory);
+  }
+
+  if (searchTerm) {
+    filtered = filterProducts(filtered, "", searchTerm);
+  }
+
   renderProducts(filtered, document.getElementById("products-container"), handleAdd);
 }
 
 /**
  * Inicializa la aplicación.
  */
 async function init() {
   // Cargar carrito desde localStorage
   loadCart();
   updateCartCount(document.getElementById("cart-count"), totalItems());
 
   try {
     // Cargar productos
     products = await fetchProducts();
+    baseProducts = products;
 
     // Categorías
     const categoryFilter = document.getElementById("category-filter");
     if (categoryFilter) populateCategories(products, categoryFilter);
 
+    renderCategoryAccordion(products, (filteredList) => {
+      baseProducts = filteredList;
+      applySearchAndFilter();
+    });
+
     // Render catálogo
-    renderProducts(products, document.getElementById("products-container"), handleAdd);
+    applySearchAndFilter();
 
     // ✅ Render carrusel de ofertas + click => ir al catálogo
     renderOffersCarousel(
       products,
       document.querySelector(".offers-frame"),
       document.querySelector("#offers-track"), // ✅ en tu HTML es ID
       (productId) => goToCatalogAndShowProduct(productId)
     );
 
     // Render carrito inicial + total
     rerenderCartUI();
   } catch (err) {
     console.error(err);
     const pc = document.getElementById("products-container");
     if (pc) pc.innerHTML = `<p>Ocurrió un error al cargar los productos.</p>`;
   }
 
   // Eventos filtros
   const searchEl = document.getElementById("search-input");
   if (searchEl) searchEl.addEventListener("input", applySearchAndFilter);
 
   const catEl = document.getElementById("category-filter");
   if (catEl) catEl.addEventListener("change", applySearchAndFilter);
 
   // Vaciar carrito
 
EOF
)