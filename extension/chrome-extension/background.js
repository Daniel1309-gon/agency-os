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

async function apiRequest(path, options, context, config) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      authorization: `Bearer ${context.accessToken}`,
      'content-type': 'application/json',
      'x-device-token': config.deviceToken,
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
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const context = stored[SESSION_KEY];
  if (!context || context.profileId !== profileId || context.sessionId !== sessionId || context.expiresAt <= Date.now()) {
    throw new Error('La sesión preparada no existe o expiró');
  }
  const config = await managedConfiguration();
  try {
    const grant = await apiRequest('/agent/session/credential-grant', {
      method: 'POST',
      body: JSON.stringify({ profileId, sessionId }),
    }, context, config);
    const credential = await apiRequest('/agent/session/credential-redeem', {
      method: 'POST',
      body: JSON.stringify({ grantId: grant.grantId }),
    }, context, config);
    return { username: credential.username, secret: credential.secret };
  } catch (error) {
    await apiRequest(`/agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ERROR', errorCode: 'CREDENTIAL_INJECTION_FAILED' }),
    }, context, config).catch(() => undefined);
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
    await apiRequest(`/agent/sessions/${encodeURIComponent(context.sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ERROR', errorCode: 'CREDENTIAL_INJECTION_FAILED' }),
    }, context, config).catch(() => undefined);
  } else {
    const config = await managedConfiguration();
    await apiRequest(`/agent/sessions/${encodeURIComponent(context.sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACTIVE' }),
    }, context, config);
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
    await chrome.storage.session.set({
      [SESSION_KEY]: {
        profileId: message.profileId,
        sessionId: message.sessionId,
        accessToken: message.accessToken,
        chromeProfileDir: message.chromeProfileDir,
        launchUrl: message.launchUrl,
        expiresAt: Date.now() + 60_000,
      },
    });
    try {
      await launchNativeProfile(message, config);
    } catch (error) {
      await chrome.storage.session.remove(SESSION_KEY);
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
