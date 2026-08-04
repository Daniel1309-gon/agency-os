// Service worker (MV3): unico contexto que puede hacer fetch a file:// con
// host_permissions. El content script no puede (corre en el origin de la
// pagina https, y Chrome bloquea fetch a file:// desde https por secure
// context). El content script le pide aca el JSON y el background lo sirve.
//
// REQUIERE: en chrome://extensions, activar "Permitir acceso a URLs de
// archivo" para esta extension -- sino fetch a file:// falla silenciosamente.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.tipo === 'obtenerCredenciales') {
    fetch(msg.url)
      .then((r) => r.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});
