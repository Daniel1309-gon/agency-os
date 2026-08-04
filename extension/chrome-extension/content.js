// Spike: inyecta la credencial dummy que corresponde a ESTE perfil nativo,
// leyendo el mapeo id->credencial desde credenciales.json.
//
// La extension no sabe su --profile-directory. El helper le pasa un id ligero
// via query param (?agencyPerfil=N) al lanzar Chrome, y este content script
// usa ese id para buscar su credencial en el JSON (via el background worker,
// que es quien puede hacer fetch a file://).
//
// Vue no reacciona a `input.value = x` directo -- hay que usar el setter
// nativo del prototipo y disparar 'input'/'change' (verificado 2026-07-30).

// Ruta absoluta al JSON de mapeo. Ajustala si moves el repo de lugar.
const CREDENCIALES_URL =
  'file:///C:/Users/danig/Documents/AGENCY-OS/agency-os/extension/credenciales.json';

let yaInyectado = false;

function ocultarTogglePassword() {
  document.querySelectorAll('svg#Eye, svg#EyeOff').forEach((icon) => {
    icon.style.display = 'none';
    icon.style.pointerEvents = 'none';
    icon.remove();
  });
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function inyectarCredencial() {
  if (yaInyectado) return;
  const perfilId = new URLSearchParams(location.search).get('agencyPerfil');
  if (!perfilId) {
    console.warn('[Agency OS spike] Falta ?agencyPerfil=N en la URL. No se inyecta.');
    return;
  }
  const resp = await chrome.runtime.sendMessage({
    tipo: 'obtenerCredenciales',
    url: CREDENCIALES_URL,
  });
  if (!resp || !resp.ok) {
    console.error('[Agency OS spike] fetch credenciales fallo:', resp && resp.error);
    return;
  }
  const entrada = resp.data.find((c) => String(c.id) === String(perfilId));
  if (!entrada) {
    console.warn('[Agency OS spike] Sin entrada id=' + perfilId + ' en credenciales.json');
    return;
  }
  const emailInput = document.querySelector('input[type="email"]');
  const passwordInput = document.querySelector('input[type="password"]');
  if (emailInput && passwordInput && !emailInput.value) {
    setNativeValue(emailInput, entrada.email);
    setNativeValue(passwordInput, entrada.password);
    yaInyectado = true;
    console.log(
      '[Agency OS spike] credencial inyectada id=' + perfilId + ' (' + entrada.perfil + ')'
    );
  }
}

function revisarDOM() {
  ocultarTogglePassword();
  inyectarCredencial();
}

revisarDOM();
new MutationObserver(revisarDOM).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
