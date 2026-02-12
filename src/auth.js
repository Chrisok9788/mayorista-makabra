const USER_CODE_KEY = 'mmw_user_code';
const USER_CODE_SET_AT_KEY = 'mmw_user_code_set_at';

function sanitizeUserCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function isValidUserCode(value) {
  return value.length >= 4 && value.length <= 32;
}

function safeLocalStorageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // noop
  }
}

export function getUserCode() {
  const raw = safeLocalStorageGet(USER_CODE_KEY);
  const sanitized = sanitizeUserCode(raw);
  if (!isValidUserCode(sanitized)) return '';
  return sanitized;
}

export function getMaskedUserCode() {
  const code = getUserCode();
  if (!code) return 'Sin código';
  const suffix = code.slice(-4);
  return `••••${suffix}`;
}

export function setUserCode(code) {
  const sanitized = sanitizeUserCode(code);
  if (!isValidUserCode(sanitized)) {
    throw new Error('El código debe tener entre 4 y 32 caracteres.');
  }

  const codeSaved = safeLocalStorageSet(USER_CODE_KEY, sanitized);
  const dateSaved = safeLocalStorageSet(USER_CODE_SET_AT_KEY, new Date().toISOString());

  if (!codeSaved || !dateSaved) {
    throw new Error('No se pudo guardar tu código en este dispositivo.');
  }

  return sanitized;
}

export function clearUserCode() {
  safeLocalStorageRemove(USER_CODE_KEY);
  safeLocalStorageRemove(USER_CODE_SET_AT_KEY);
}

function upsertAuthSummary() {
  const maskEl = document.getElementById('auth-code-mask');
  const btn = document.getElementById('auth-logout-btn');
  if (maskEl) maskEl.textContent = getMaskedUserCode();
  if (btn) btn.hidden = !getUserCode();
}

function createGate() {
  let gate = document.getElementById('auth-gate');
  if (gate) return gate;

  gate = document.createElement('div');
  gate.id = 'auth-gate';
  gate.className = 'auth-gate';
  gate.innerHTML = `
    <div class="auth-gate__card" role="dialog" aria-modal="true" aria-labelledby="auth-gate-title">
      <h1 id="auth-gate-title">Ingresá tu código único</h1>
      <p class="auth-gate__text">Usá tu PIN/ID personal para acceder al catálogo.</p>
      <form id="auth-gate-form" class="auth-gate__form" novalidate>
        <label for="auth-user-code">Código único</label>
        <input
          id="auth-user-code"
          name="userCode"
          type="text"
          minlength="4"
          maxlength="32"
          autocomplete="one-time-code"
          inputmode="text"
          required
          placeholder="Ej: AB12-4455"
        />
        <p id="auth-gate-error" class="auth-gate__error" role="alert" aria-live="polite"></p>
        <button type="submit" class="btn btn-primary">Ingresar</button>
      </form>
    </div>
  `;

  document.body.appendChild(gate);
  return gate;
}

function showGate({ onAuthed }) {
  const gate = createGate();
  const form = gate.querySelector('#auth-gate-form');
  const input = gate.querySelector('#auth-user-code');
  const error = gate.querySelector('#auth-gate-error');

  const setError = (msg) => {
    if (error) error.textContent = msg;
  };

  if (!form || !input) return;

  document.body.classList.add('auth-gate-active');
  gate.hidden = false;
  window.setTimeout(() => input.focus(), 0);

  if (form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setError('');

    const code = sanitizeUserCode(input.value);

    if (!code) {
      setError('Ingresá un código para continuar.');
      input.focus();
      return;
    }

    if (!isValidUserCode(code)) {
      setError('El código debe tener entre 4 y 32 caracteres.');
      input.focus();
      return;
    }

    try {
      setUserCode(code);
      input.value = '';
      gate.hidden = true;
      document.body.classList.remove('auth-gate-active');
      upsertAuthSummary();
      if (typeof onAuthed === 'function') onAuthed();
    } catch (err) {
      setError(String(err?.message || 'No se pudo guardar el código.'));
    }
  });
}

export function initAuthGate({ onAuthed } = {}) {
  const logoutBtn = document.getElementById('auth-logout-btn');

  if (logoutBtn && logoutBtn.dataset.bound !== 'true') {
    logoutBtn.dataset.bound = 'true';
    logoutBtn.addEventListener('click', () => {
      clearUserCode();
      upsertAuthSummary();
      showGate({ onAuthed });
    });
  }

  upsertAuthSummary();

  if (getUserCode()) {
    document.body.classList.remove('auth-gate-active');
    if (typeof onAuthed === 'function') onAuthed();
    return;
  }

  showGate({ onAuthed });
}

