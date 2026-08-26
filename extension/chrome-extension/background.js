const SESSION_KEY = 'agencySessionContext';

async function managedConfiguration() {
  const config = await chrome.storage.managed.get(['apiBaseUrl', 'webAppOrigin', 'deviceToken', 'nativeHostName']);
  if (!config.apiBaseUrl || !config.webAppOrigin || !config.deviceToken) {
    throw new Error('La política administrada de Agency OS está incompleta');
  }
  const api = new URL(config.apiBaseUrl);
  const webApp = new URL(config.webAppOrigin);
  if (api.protocol !== 'https:' && api.hostname !== 'localhost') throw new Error('El API debe usar HTTPS');
  if (webApp.protocol !== 'https:' && webApp.hostname !== 'localhost') throw new Error('El web-app debe usar HTTPS');
  return {
    apiBaseUrl: api.href.replace(/\/$/, ''),
    webAppOrigin: webApp.origin,
    deviceToken: config.deviceToken,
    nativeHostName: config.nativeHostName || 'com.agencyos.helper',
  };
}

async function apiRequest(path, options, config, accessToken) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      'content-type': 'application/json',
      'x-device-token': config.deviceToken,
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.message || `Agency OS respondió ${response.status}`);
  return body;
}

function isValidChromeProfileDir(value) {
  return typeof value === 'string' && /^(Default|Profile \d{1,3})$/.test(value);
}

function isValidLaunchUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'talkytimes.com' && url.pathname.startsWith('/auth/login');
  } catch {
    return false;
  }
}

function validateSessionContext(message) {
  if (![message.profileId, message.sessionId, message.accessToken].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('Contexto de sesión inválido');
  }
  if (!Number.isInteger(message.version) || message.version < 1) {
    throw new Error('Versión de sesión inválida');
  }
  if (!isValidChromeProfileDir(message.chromeProfileDir) || !isValidLaunchUrl(message.launchUrl)) {
    throw new Error('Destino de sesión inválido');
  }
}

async function launchNativeProfile(message, config) {
  const response = await chrome.runtime.sendNativeMessage(config.nativeHostName, {
    action: 'launchProfile',
    profileId: message.profileId,
    sessionId: message.sessionId,
    chromeProfileDir: message.chromeProfileDir,
    launchUrl: message.launchUrl,
  });
  if (!response?.ok) throw new Error('El helper local no pudo abrir el perfil');
}

async function obtenerCredencial(profileId, sessionId) {
  const config = await managedConfiguration();
  let sessionVersion;
  try {
    const credential = await apiRequest('/station/credential-claims', {
      method: 'POST',
      body: JSON.stringify({ profileId, sessionId }),
    }, config);
    if (
      typeof credential.username !== 'string'
      || typeof credential.secret !== 'string'
      || !Number.isInteger(credential.sessionVersion)
      || credential.sessionVersion < 1
    ) {
      throw new Error('Agency OS entregó una credencial inválida');
    }
    sessionVersion = credential.sessionVersion;
    await chrome.storage.session.set({
      [SESSION_KEY]: {
        profileId,
        sessionId,
        version: sessionVersion,
        expiresAt: Date.now() + 60_000,
      },
    });
    return { username: credential.username, secret: credential.secret };
  } catch (error) {
    if (sessionVersion) {
      await apiRequest(`/station/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ERROR', version: sessionVersion, errorCode: 'CREDENTIAL_INJECTION_FAILED' }),
      }, config).catch(() => undefined);
    }
    await chrome.storage.session.remove(SESSION_KEY);
    throw error;
  }
}

function isTalkyTimesSender(sender) {
  try {
    const url = new URL(sender.url || '');
    return url.protocol === 'https:' && url.hostname === 'talkytimes.com';
  } catch {
    return false;
  }
}

async function finishCredentialInjection(message) {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const context = stored[SESSION_KEY];
  if (!context || context.profileId !== message.profileId || context.sessionId !== message.sessionId) {
    throw new Error('El contexto de inyección no coincide');
  }
  if (message.type === 'credentialInjectionFailed') {
    const config = await managedConfiguration();
    await apiRequest(`/station/sessions/${encodeURIComponent(context.sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ERROR', version: context.version, errorCode: 'CREDENTIAL_INJECTION_FAILED' }),
    }, config).catch(() => undefined);
  } else {
    const config = await managedConfiguration();
    await apiRequest(`/station/sessions/${encodeURIComponent(context.sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACTIVE', version: context.version }),
    }, config);
  }
  await chrome.storage.session.remove(SESSION_KEY);
  return { ok: true };
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  (async () => {
    const config = await managedConfiguration();
    if (!sender.url || new URL(sender.url).origin !== config.webAppOrigin) throw new Error('Origin no autorizado');
    if (message?.action !== 'prepareSession') throw new Error('Acción no permitida');
    validateSessionContext(message);
    try {
      await launchNativeProfile(message, config);
    } catch (error) {
      await apiRequest(`/agent/sessions/${encodeURIComponent(message.sessionId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ERROR', version: message.version, errorCode: 'PROFILE_LAUNCH_FAILED' }),
      }, config, message.accessToken).catch(() => undefined);
      throw error;
    }
    return { ok: true };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['requestCredential', 'credentialInjectionComplete', 'credentialInjectionFailed'].includes(message?.type)) return false;
  if (!isTalkyTimesSender(sender)) {
    sendResponse({ ok: false, error: 'Origen de content script no autorizado' });
    return false;
  }
  const operation = message.type === 'requestCredential'
    ? obtenerCredencial(message.profileId, message.sessionId).then((credential) => ({ ok: true, credential }))
    : finishCredentialInjection(message);
  operation
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
