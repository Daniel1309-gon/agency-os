let injected = false;
let requesting = false;

function hidePasswordToggle() {
  document.querySelectorAll('svg#Eye, svg#EyeOff').forEach((icon) => icon.remove());
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('No se encontró el setter nativo del formulario');
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function injectCredential() {
  if (injected || requesting) return;
  const query = new URLSearchParams(location.search);
  const profileId = query.get('agencyProfile');
  const sessionId = query.get('agencySession');
  if (!profileId || !sessionId) return;
  const email = document.querySelector('input[type="email"]');
  const password = document.querySelector('input[type="password"]');
  if (!email || !password || email.value) return;
  requesting = true;
  let credentialReceived = false;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'requestCredential', profileId, sessionId });
    if (!response?.ok) throw new Error(response?.error || 'Agency OS no entregó la credencial');
    credentialReceived = true;
    try {
      setNativeValue(email, response.credential.username);
      setNativeValue(password, response.credential.secret);
      injected = true;
    } finally {
      response.credential.username = '';
      response.credential.secret = '';
    }
    await chrome.runtime.sendMessage({ type: 'credentialInjectionComplete', profileId, sessionId });
  } catch {
    if (credentialReceived && !injected) {
      await chrome.runtime.sendMessage({ type: 'credentialInjectionFailed', profileId, sessionId }).catch(() => undefined);
    }
    // No se imprime el error: una respuesta de infraestructura podría incluir
    // contexto sensible. El backend conserva la causa sanitizada y auditable.
  } finally {
    requesting = false;
  }
}

function inspectDom() {
  hidePasswordToggle();
  void injectCredential();
}

inspectDom();
new MutationObserver(inspectDom).observe(document.documentElement, { childList: true, subtree: true });
