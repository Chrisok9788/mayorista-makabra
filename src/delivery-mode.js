const PROFILE_KEY = "mmw_delivery_profile";
const SET_AT_KEY = "mmw_delivery_set_at";
const CODE_REGEX = /^\d{7,8}$/;

let currentProfile = null;

function sanitizeCode(input) {
  return String(input || "").replace(/[\s.-]/g, "").trim();
}

function isValidProfile(profile) {
  if (!profile || typeof profile !== "object") return false;
  const code = String(profile.code || "").trim();
  const name = String(profile.name || "").trim();
  const address = String(profile.address || "").trim();
  const phone = String(profile.phone || "").trim();
  return CODE_REGEX.test(code) && Boolean(name) && Boolean(address) && Boolean(phone);
}

function normalizeProfile(profile) {
  return {
    code: String(profile.code).trim(),
    name: String(profile.name).trim(),
    address: String(profile.address).trim(),
    phone: String(profile.phone).trim(),
  };
}

function readStoredProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidProfile(parsed)) return null;
    return normalizeProfile(parsed);
  } catch {
    return null;
  }
}

function persistProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  localStorage.setItem(SET_AT_KEY, new Date().toISOString());
}

function clearStorage() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(SET_AT_KEY);
}

function getMaskedCode(code) {
  const safe = String(code || "");
  if (!safe) return "";
  return `••••${safe.slice(-3)}`;
}

function updateStatusUI() {
  const status = document.getElementById("delivery-status");
  const details = document.getElementById("delivery-details");
  const deactivate = document.getElementById("delivery-deactivate");
  if (!status || !details || !deactivate) return;

  if (!currentProfile) {
    status.textContent = "Reparto inactivo";
    details.innerHTML = "";
    deactivate.hidden = true;
    return;
  }

  status.textContent = `Reparto activo: ${currentProfile.name} (${getMaskedCode(currentProfile.code)})`;
  details.innerHTML = `
    <div><strong>Dirección:</strong> ${currentProfile.address}</div>
    <div><strong>Tel:</strong> ${currentProfile.phone}</div>
  `;
  deactivate.hidden = false;
}

function closeModal() {
  const modal = document.getElementById("delivery-modal");
  if (!modal) return;
  modal.hidden = true;
}

function openModal() {
  const modal = document.getElementById("delivery-modal");
  const input = document.getElementById("delivery-code-input");
  const error = document.getElementById("delivery-feedback");
  if (!modal || !input || !error) return;
  error.textContent = "";
  input.value = "";
  modal.hidden = false;
  setTimeout(() => input.focus(), 30);
}

async function validateAndActivate() {
  const input = document.getElementById("delivery-code-input");
  const feedback = document.getElementById("delivery-feedback");
  const submitBtn = document.getElementById("delivery-submit");
  if (!input || !feedback || !submitBtn) return;

  const code = sanitizeCode(input.value);
  input.value = code;

  if (!code) {
    clearDeliveryProfile();
    closeModal();
    return;
  }

  if (!CODE_REGEX.test(code)) {
    feedback.textContent = "Ingresá CI de 7 u 8 dígitos";
    return;
  }

  submitBtn.disabled = true;
  feedback.textContent = "Validando...";

  try {
    const res = await fetch("/api/validate-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ code }),
    });

    if (res.status === 404) {
      feedback.textContent = "Código no registrado";
      return;
    }

    if (!res.ok) {
      feedback.textContent = "No se pudo validar";
      return;
    }

    const data = await res.json();
    if (!data?.valid || !isValidProfile(data.profile)) {
      feedback.textContent = "No se pudo validar";
      return;
    }

    setDeliveryProfile(data.profile);
    closeModal();
  } catch {
    feedback.textContent = "No se pudo validar";
  } finally {
    submitBtn.disabled = false;
  }
}

function ensureUI() {
  const headerRow = document.querySelector(".header-row");
  if (!headerRow) return;

  const nav = headerRow.querySelector(".main-nav");
  if (nav && !document.getElementById("delivery-open-btn")) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = "delivery-open-btn";
    button.className = "delivery-open-btn";
    button.textContent = "Reparto";
    nav.appendChild(button);
  }

  if (!document.getElementById("delivery-banner")) {
    const banner = document.createElement("section");
    banner.id = "delivery-banner";
    banner.className = "delivery-banner";
    banner.innerHTML = `
      <div class="container delivery-banner-inner">
        <div>
          <div id="delivery-status" class="delivery-status" role="status" aria-live="polite">Reparto inactivo</div>
          <div id="delivery-details" class="delivery-details"></div>
        </div>
        <button id="delivery-deactivate" class="btn" type="button" hidden>Desactivar</button>
      </div>
    `;
    const siteHeader = document.querySelector(".site-header");
    if (siteHeader) {
      siteHeader.insertAdjacentElement("afterend", banner);
    }
  }

  if (!document.getElementById("delivery-modal")) {
    const modal = document.createElement("div");
    modal.id = "delivery-modal";
    modal.className = "delivery-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="delivery-modal-backdrop" data-close-delivery="1"></div>
      <div class="delivery-modal-card" role="dialog" aria-modal="true" aria-labelledby="delivery-modal-title">
        <h3 id="delivery-modal-title">Modo Reparto</h3>
        <label for="delivery-code-input">CI (7 u 8 dígitos, opcional)</label>
        <input id="delivery-code-input" inputmode="numeric" autocomplete="off" placeholder="12345678" maxlength="12" />
        <p id="delivery-feedback" class="delivery-feedback" aria-live="polite"></p>
        <div class="delivery-modal-actions">
          <button type="button" class="btn" id="delivery-cancel">Cancelar</button>
          <button type="button" class="btn btn-primary" id="delivery-submit">Activar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

function bindEvents() {
  const openBtn = document.getElementById("delivery-open-btn");
  const modal = document.getElementById("delivery-modal");
  const deactivate = document.getElementById("delivery-deactivate");
  const cancel = document.getElementById("delivery-cancel");
  const submit = document.getElementById("delivery-submit");
  const input = document.getElementById("delivery-code-input");

  openBtn?.addEventListener("click", openModal);
  cancel?.addEventListener("click", closeModal);
  submit?.addEventListener("click", validateAndActivate);

  modal?.addEventListener("click", (event) => {
    if (event.target?.getAttribute("data-close-delivery") === "1") {
      closeModal();
    }
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      validateAndActivate();
    }
  });

  deactivate?.addEventListener("click", () => {
    clearDeliveryProfile();
  });
}

export function initDeliveryModeUI() {
  const stored = readStoredProfile();
  if (stored) {
    currentProfile = stored;
  } else {
    clearStorage();
    currentProfile = null;
  }

  ensureUI();
  bindEvents();
  updateStatusUI();
}

export function isDeliveryActive() {
  return Boolean(currentProfile);
}

export function getDeliveryProfile() {
  return currentProfile ? { ...currentProfile } : null;
}

export function setDeliveryProfile(profile) {
  if (!isValidProfile(profile)) return false;
  currentProfile = normalizeProfile(profile);
  persistProfile(currentProfile);
  updateStatusUI();
  return true;
}

export function clearDeliveryProfile() {
  currentProfile = null;
  clearStorage();
  updateStatusUI();
}

export function getMaskedDeliveryCode() {
  if (!currentProfile) return "";
  return getMaskedCode(currentProfile.code);
}
