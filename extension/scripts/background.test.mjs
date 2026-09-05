import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(join(root, 'chrome-extension', 'background.js'), 'utf8');
const PROFILE = '22222222-2222-2222-2222-222222222222';
const SESSION = '33333333-3333-3333-3333-333333333333';
const plain = (value) => JSON.parse(JSON.stringify(value));

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function harness(fetchHandler = async () => response({})) {
  const listeners = {};
  const session = {};
  const sessionWrites = [];
  const sessionRemovals = [];
  const nativeMessages = [];
  const fetches = [];
  const config = {
    apiBaseUrl: 'http://localhost:3000/api/v1',
    webAppOrigin: 'http://localhost:5173',
    deviceToken: 'managed-device-token',
    nativeHostName: 'com.agencyos.helper',
  };
  const chrome = {
    storage: {
      managed: { async get() { return config; } },
      session: {
        async get(key) { return { [key]: session[key] }; },
        async set(value) {
          sessionWrites.push(structuredClone(value));
          Object.assign(session, value);
        },
        async remove(key) {
          sessionRemovals.push(key);
          delete session[key];
        },
      },
    },
    runtime: {
      getManifest() { return { version: '1.0.0' }; },
      onMessageExternal: { addListener(listener) { listeners.external = listener; } },
      onMessage: { addListener(listener) { listeners.internal = listener; } },
      async sendNativeMessage(host, message) {
        nativeMessages.push({ host, message: structuredClone(message) });
        return { ok: true };
      },
    },
  };
  const fetch = async (url, options) => {
    fetches.push({ url, options: structuredClone(options) });
    return fetchHandler(url, options, fetches.length);
  };
  vm.runInNewContext(source, { chrome, fetch, URL, Date, JSON, Error, console, encodeURIComponent, setTimeout, clearTimeout });

  const invoke = (listener, message, sender) => new Promise((resolve) => {
    const asynchronous = listener(message, sender, resolve);
    if (asynchronous !== true) setTimeout(() => resolve(undefined), 0);
  });
  return { fetches, invoke, listeners, nativeMessages, session, sessionRemovals, sessionWrites };
}

const preparedMessage = {
  action: 'prepareSession',
  accessToken: 'operator-jwt-must-stay-in-control-profile',
  profileId: PROFILE,
  sessionId: SESSION,
  chromeProfileDir: 'Profile 10',
  launchUrl: `https://talkytimes.com/auth/login?agencyProfile=${PROFILE}&agencySession=${SESSION}`,
  version: 1,
};

test('the control profile launches Chrome without persisting or forwarding the operator JWT', async () => {
  const h = harness();

  const result = await h.invoke(h.listeners.external, preparedMessage, { url: 'http://localhost:5173/operator' });

  assert.deepEqual(plain(result), { ok: true });
  assert.equal(h.sessionWrites.length, 0);
  assert.equal(h.fetches[0].url, 'http://localhost:3000/api/v1/agent/devices/heartbeat');
  assert.equal(h.fetches[0].options.headers.authorization, `Bearer ${preparedMessage.accessToken}`);
  assert.deepEqual(JSON.parse(h.fetches[0].options.body), { extensionVersion: '1.0.0' });
  assert.equal(JSON.stringify(h.nativeMessages).includes(preparedMessage.accessToken), false);
  assert.deepEqual(h.nativeMessages[0].message, {
    action: 'launchProfile',
    profileId: PROFILE,
    sessionId: SESSION,
    chromeProfileDir: 'Profile 10',
    launchUrl: preparedMessage.launchUrl,
  });
});

test('a fresh target profile claims the credential with its managed device token and no JWT', async () => {
  const h = harness(async () => response({
    username: 'perfil@talky.test',
    secret: 'credential-from-vault',
    sessionVersion: 1,
  }));

  const result = await h.invoke(
    h.listeners.internal,
    { type: 'requestCredential', profileId: PROFILE, sessionId: SESSION },
    { url: preparedMessage.launchUrl },
  );

  assert.deepEqual(plain(result), {
    ok: true,
    credential: { username: 'perfil@talky.test', secret: 'credential-from-vault' },
  });
  assert.equal(h.fetches.length, 1);
  assert.equal(h.fetches[0].url, 'http://localhost:3000/api/v1/station/credential-claims');
  assert.equal('authorization' in h.fetches[0].options.headers, false);
  assert.equal(h.fetches[0].options.headers['x-device-token'], 'managed-device-token');
  assert.deepEqual(JSON.parse(h.fetches[0].options.body), { profileId: PROFILE, sessionId: SESSION });
  assert.equal(JSON.stringify(h.session).includes('credential-from-vault'), false);
  assert.equal(JSON.stringify(h.session).includes('operator-jwt'), false);
  assert.deepEqual(plain(h.session.agencySessionContext), {
    profileId: PROFILE,
    sessionId: SESSION,
    version: 1,
    expiresAt: h.session.agencySessionContext.expiresAt,
  });
});

test('the target profile marks injection complete through the station endpoint and clears context', async () => {
  const h = harness(async (_url, _options, call) => call === 1
    ? response({ username: 'perfil@talky.test', secret: 'credential-from-vault', sessionVersion: 4 })
    : response({ id: SESSION, status: 'ACTIVE', version: 5 }));
  await h.invoke(
    h.listeners.internal,
    { type: 'requestCredential', profileId: PROFILE, sessionId: SESSION },
    { url: preparedMessage.launchUrl },
  );

  const result = await h.invoke(
    h.listeners.internal,
    { type: 'credentialInjectionComplete', profileId: PROFILE, sessionId: SESSION },
    { url: preparedMessage.launchUrl },
  );

  assert.deepEqual(plain(result), { ok: true });
  assert.equal(h.fetches[1].url, `http://localhost:3000/api/v1/station/sessions/${SESSION}`);
  assert.equal('authorization' in h.fetches[1].options.headers, false);
  assert.deepEqual(JSON.parse(h.fetches[1].options.body), { status: 'ACTIVE', version: 4 });
  assert.equal(h.session.agencySessionContext, undefined);
  assert.deepEqual(h.sessionRemovals, ['agencySessionContext']);
});
