const modal = document.getElementById("cart-modal");
const openButton = document.getElementById("cart-open-btn");
const closeButton = document.getElementById("cart-close-btn");
const continueButton = document.getElementById("cart-continue-btn");
const backdrop = modal?.querySelector("[data-cart-close]");

let lastFocusedElement = null;
let closeTimer = null;

function openCart() {
  if (!modal || !openButton) return;

  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  lastFocusedElement = document.activeElement;
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("cart-modal-open");
  openButton.setAttribute("aria-expanded", "true");

  requestAnimationFrame(() => {
    modal.classList.add("is-open");
    closeButton?.focus({ preventScroll: true });
  });
}

function closeCart() {
  if (!modal || modal.hidden) return;

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("cart-modal-open");
  openButton?.setAttribute("aria-expanded", "false");

  closeTimer = window.setTimeout(() => {
    modal.hidden = true;
    closeTimer = null;
  }, 230);

  if (lastFocusedElement instanceof HTMLElement) {
    lastFocusedElement.focus({ preventScroll: true });
  } else {
    openButton?.focus({ preventScroll: true });
  }
}

function keepFocusInside(event) {
  if (!modal || modal.hidden || event.key !== "Tab") return;

  const focusable = [...modal.querySelectorAll(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => node instanceof HTMLElement && node.offsetParent !== null);

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

openButton?.addEventListener("click", openCart);
closeButton?.addEventListener("click", closeCart);
continueButton?.addEventListener("click", closeCart);
backdrop?.addEventListener("click", closeCart);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal && !modal.hidden) {
    event.preventDefault();
    closeCart();
    return;
  }

  keepFocusInside(event);
});

window.addEventListener("pageshow", () => {
  if (!modal) return;
  modal.hidden = true;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("cart-modal-open");
  openButton?.setAttribute("aria-expanded", "false");
});
