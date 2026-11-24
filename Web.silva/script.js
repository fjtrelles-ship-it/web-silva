const products = window.FERREMAX_PRODUCTS;
const money = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
const CART_KEY = "ferremax-cart";
const FAVORITES_KEY = "ferremax-favorites";
const WHATSAPP_NUMBER = "51984594013";
const featuredIds = [1, 2, 3, 7, 5, 8];
const cart = loadCart();
let activeCategory = "Todos";
let searchTerm = "";
let toastTimeout;

const productGrid = document.querySelector("#product-grid");
const cartDrawer = document.querySelector("#cart-drawer");
const scrim = document.querySelector("#scrim");
const cartItems = document.querySelector("#cart-items");
const cartEmpty = document.querySelector("#cart-empty");
const cartSummary = document.querySelector("#cart-summary");
const deliverySelect = document.querySelector("#delivery-method");
const favorites = loadFavorites();
let recentlyAddedProductId = null;

function loadCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    return new Map(stored.filter((item) => products.some((product) => product.id === item.id) && item.quantity > 0)
      .map((item) => [item.id, { product: products.find((product) => product.id === item.id), quantity: item.quantity }]));
  } catch (error) {
    console.error("No se pudo recuperar el carrito guardado.", error);
    return new Map();
  }
}

function loadFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
  } catch (error) {
    console.error("No se pudieron recuperar los favoritos guardados.", error);
    return new Set();
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify([...cart].map(([id, item]) => ({ id, quantity: item.quantity }))));
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

function productVisual(product) {
  if (product.image) {
    return `<img class="product-image" src="${product.image}" alt="${product.name}" loading="lazy">`;
  }
  return `<span class="product-image-placeholder">Imagen del producto</span>`;
}

document.addEventListener("error", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.classList.contains("product-image")) return;
  const placeholder = document.createElement("span");
  placeholder.className = "product-image-placeholder";
  placeholder.textContent = "Imagen del producto";
  image.replaceWith(placeholder);
}, true);

function productCard(product) {
  const isFavorite = favorites.has(product.id);
  return `
    <article class="product-card">
      <div class="product-visual" style="--product-bg: ${product.bg || "#eaf0e5"}">
        ${product.badge ? `<span class="product-badge">${product.badge}</span>` : ""}
        <button class="favorite-button" type="button" aria-label="${isFavorite ? "Quitar" : "Guardar"} ${product.name} en favoritos" aria-pressed="${isFavorite}">${isFavorite ? "♥" : "♡"}</button>
        ${productVisual(product)}
      </div>
      <div class="product-info">
        <span class="product-category">${product.category}</span>
        <h3 class="product-name">${product.name}</h3>
        <div class="product-purchase">
          <strong class="product-price">${money.format(product.price)}</strong>
          <button class="add-button" type="button" data-add="${product.id}"><span aria-hidden="true">+</span> Agregar</button>
        </div>
      </div>
    </article>
  `;
}

function renderProducts() {
  if (!productGrid) return;
  const isCatalog = productGrid.dataset.catalog === "true";
  const query = searchTerm.trim().toLocaleLowerCase("es-MX");
  let visible = isCatalog ? [...products] : products.filter((product) => featuredIds.includes(product.id));
  if (isCatalog) {
    visible = visible.filter((product) => {
      const matchesCategory = activeCategory === "Todos" || product.category === activeCategory;
      const matchesSearch = !query || `${product.name} ${product.category}`.toLocaleLowerCase("es-MX").includes(query);
      return matchesCategory && matchesSearch;
    });

    const sort = document.querySelector("#sort-select").value;
    if (sort === "price-low") visible.sort((a, b) => a.price - b.price);
    if (sort === "price-high") visible.sort((a, b) => b.price - a.price);
    if (sort === "name") visible.sort((a, b) => a.name.localeCompare(b.name, "es"));
    document.querySelector("#result-count").textContent = `${visible.length} ${visible.length === 1 ? "producto" : "productos"}`;
  }

  productGrid.innerHTML = visible.map(productCard).join("");
  const emptyState = document.querySelector("#empty-state");
  if (emptyState) emptyState.hidden = visible.length > 0;
  productGrid.hidden = visible.length === 0;
}

function renderFilters() {
  const filterContainer = document.querySelector("#category-filters");
  if (!filterContainer) return;
  const categories = ["Todos", ...new Set(products.map((product) => product.category))];
  filterContainer.innerHTML = categories.map((category) => `
    <button class="filter-chip" type="button" data-category="${category}" aria-pressed="${category === activeCategory}">${category}</button>
  `).join("");
}

function cartQuantity() {
  return [...cart.values()].reduce((total, item) => total + item.quantity, 0);
}

function cartSubtotal() {
  return [...cart.values()].reduce((total, item) => total + item.product.price * item.quantity, 0);
}

function estimatedTotal() {
  return cartSubtotal();
}

function renderCart() {
  if (!cartDrawer) return;
  const quantity = cartQuantity();
  document.querySelector("#cart-count").textContent = quantity;
  document.querySelector("#drawer-count").textContent = `(${quantity})`;
  document.querySelector("#cart-subtotal").textContent = money.format(cartSubtotal());
  document.querySelector("#checkout-total").textContent = money.format(estimatedTotal());
  cartEmpty.hidden = quantity > 0;
  cartSummary.hidden = quantity === 0;
  cartItems.innerHTML = [...cart.values()].map(({ product, quantity: count }) => `
    <article class="cart-item${product.id === recentlyAddedProductId ? " is-new" : ""}">
      <div class="cart-item-visual" style="--product-bg: ${product.bg || "#eaf0e5"}">${productVisual(product)}</div>
      <div>
        <h3 class="cart-item-name">${product.name}</h3>
        <span class="cart-item-price">${money.format(product.price)} c/u</span>
        <div class="quantity-control" aria-label="Cantidad de ${product.name}">
          <button type="button" data-quantity="${product.id}" data-change="-1" aria-label="Quitar una unidad">−</button>
          <span>${count}</span>
          <button type="button" data-quantity="${product.id}" data-change="1" aria-label="Agregar una unidad">+</button>
        </div>
      </div>
      <button class="remove-item" type="button" data-remove="${product.id}" aria-label="Quitar ${product.name} del carrito">×</button>
    </article>
  `).join("");
  recentlyAddedProductId = null;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function openCart() {
  cartDrawer.classList.add("is-open");
  cartDrawer.setAttribute("aria-hidden", "false");
  scrim.hidden = false;
  document.body.classList.add("has-open-cart");
  document.querySelector("#close-cart").focus();
}

function closeCart() {
  cartDrawer.classList.remove("is-open");
  cartDrawer.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
  document.body.classList.remove("has-open-cart");
}

function updateDeliveryFields() {
  const addressFields = document.querySelector("#delivery-address-fields");
  if (!addressFields || !deliverySelect) return;
  const needsAddress = deliverySelect.value === "Domicilio";
  addressFields.hidden = !needsAddress;
  addressFields.querySelectorAll("[data-delivery-required]").forEach((field) => {
    field.required = needsAddress;
  });
}

function addToCart(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;
  const item = cart.get(productId);
  cart.set(productId, { product, quantity: item ? item.quantity + 1 : 1 });
  recentlyAddedProductId = productId;
  saveCart();
  renderCart();
  const addButton = productGrid?.querySelector(`[data-add="${productId}"]`);
  const cartCount = document.querySelector("#cart-count");
  if (addButton) {
    const originalContent = addButton.innerHTML;
    addButton.classList.add("is-added");
    addButton.setAttribute("aria-label", `${product.name} agregado al carrito`);
    addButton.innerHTML = '<span aria-hidden="true">✓</span> Agregado';
    window.setTimeout(() => {
      if (!addButton.isConnected) return;
      addButton.classList.remove("is-added");
      addButton.removeAttribute("aria-label");
      addButton.innerHTML = originalContent;
    }, 1000);
  }
  if (cartCount) {
    cartCount.classList.remove("is-bumped");
    void cartCount.offsetWidth;
    cartCount.classList.add("is-bumped");
    window.setTimeout(() => cartCount.classList.remove("is-bumped"), 500);
  }
  showToast(`${product.name} se agregó al carrito`);
}

if (productGrid) {
  productGrid.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add]");
    if (addButton) addToCart(Number(addButton.dataset.add));

    const favoriteButton = event.target.closest(".favorite-button");
    if (favoriteButton) {
      const productId = Number(favoriteButton.closest(".product-card").querySelector("[data-add]").dataset.add);
      if (favorites.has(productId)) favorites.delete(productId);
      else favorites.add(productId);
      saveFavorites();
      renderProducts();
      const updatedButton = productGrid.querySelector(`[data-add="${productId}"]`)?.closest(".product-card")?.querySelector(".favorite-button");
      updatedButton?.classList.add("is-animating");
      window.setTimeout(() => updatedButton?.classList.remove("is-animating"), 450);
      showToast(favorites.has(productId) ? "Producto guardado en favoritos" : "Producto quitado de favoritos");
    }
  });
}

const filters = document.querySelector("#category-filters");
if (filters) {
  filters.addEventListener("click", (event) => {
    const filter = event.target.closest("[data-category]");
    if (!filter) return;
    activeCategory = filter.dataset.category;
    renderFilters();
    renderProducts();
  });
}

const searchForm = document.querySelector("#search-form");
if (searchForm) {
  const searchInput = document.querySelector("#search-input");
  const params = new URLSearchParams(window.location.search);
  searchInput.value = params.get("q") || "";
  searchTerm = searchInput.value;
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.location.href = `catalogo.html?q=${encodeURIComponent(searchInput.value.trim())}`;
  });
}

const sortSelect = document.querySelector("#sort-select");
if (sortSelect) sortSelect.addEventListener("change", renderProducts);

if (productGrid && productGrid.dataset.catalog === "true") {
  const params = new URLSearchParams(window.location.search);
  const requestedCategory = params.get("categoria");
  if (requestedCategory && products.some((product) => product.category === requestedCategory)) activeCategory = requestedCategory;
  searchTerm = params.get("q") || "";
  const searchInput = document.querySelector("#search-input");
  if (searchInput) searchInput.value = searchTerm;
}

document.querySelectorAll("[data-open-cart]").forEach((button) => button.addEventListener("click", openCart));
document.querySelector("#close-cart")?.addEventListener("click", closeCart);
document.querySelector("#continue-shopping")?.addEventListener("click", closeCart);
scrim?.addEventListener("click", closeCart);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && cartDrawer?.classList.contains("is-open")) closeCart();
});

cartItems?.addEventListener("click", (event) => {
  const quantityButton = event.target.closest("[data-quantity]");
  const removeButton = event.target.closest("[data-remove]");
  if (quantityButton) {
    const productId = Number(quantityButton.dataset.quantity);
    const item = cart.get(productId);
    if (!item) return;
    const nextQuantity = item.quantity + Number(quantityButton.dataset.change);
    if (nextQuantity <= 0) cart.delete(productId);
    else cart.set(productId, { ...item, quantity: nextQuantity });
    saveCart();
    renderCart();
  }
  if (removeButton) {
    cart.delete(Number(removeButton.dataset.remove));
    saveCart();
    renderCart();
  }
});

deliverySelect?.addEventListener("change", () => {
  updateDeliveryFields();
  renderCart();
});

document.querySelector("#checkout-form")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (cart.size === 0) {
    showToast("Tu carrito está vacío");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const customer = Object.fromEntries(formData.entries());
  const orderNumber = `FM-${Date.now().toString().slice(-6)}`;
  const orderLines = [...cart.values()].map(({ product, quantity }) => `- ${product.name} x${quantity}: ${money.format(product.price * quantity)}`);
  const deliveryDetails = customer.delivery === "Domicilio"
    ? [`Ciudad: ${customer.city}`, `Código postal: ${customer.postal}`, `Dirección: ${customer.address}`, customer.reference ? `Referencias: ${customer.reference}` : ""]
    : ["Recoger en tienda"];
  const message = [
    `Hola, quiero confirmar el pedido ${orderNumber}.`,
    "",
    ...orderLines,
    "",
    `Subtotal: ${money.format(cartSubtotal())}`,
    `Entrega: ${customer.delivery}`,
    `Total de productos: ${money.format(estimatedTotal())}`,
    `Pago preferido: ${customer.payment}`,
    "",
    `Nombre: ${customer.name}`,
    `Teléfono: ${customer.phone}`,
    `Correo: ${customer.email}`,
    ...deliveryDetails
  ].filter(Boolean).join("\n");

  const orderWindow = window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, "_blank");
  if (orderWindow) {
    orderWindow.opener = null;
    showToast(`Pedido ${orderNumber} preparado para WhatsApp`);
  } else {
    window.location.assign(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`);
  }
});

document.querySelector("#carousel-back")?.addEventListener("click", () => {
  productGrid.scrollBy({ left: -productGrid.clientWidth * 0.8, behavior: "smooth" });
});
document.querySelector("#carousel-next")?.addEventListener("click", () => {
  productGrid.scrollBy({ left: productGrid.clientWidth * 0.8, behavior: "smooth" });
});

renderFilters();
renderProducts();
renderCart();
updateDeliveryFields();
