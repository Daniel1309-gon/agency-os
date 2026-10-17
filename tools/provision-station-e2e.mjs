import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_API_BASE = 'https://api.agency-os.test/api/v1';

export const DEMO_CREDENTIAL_TARGETS = Object.freeze([
  { loginEmail: 'luna.demo@talkytimes.test', chromeProfileDir: 'Profile 1' },
  { loginEmail: 'mar.demo@talkytimes.test', chromeProfileDir: 'Profile 2' },
  { loginEmail: 'sol.demo@talkytimes.test', chromeProfileDir: 'Profile 3' },
  { loginEmail: 'nube.demo@talkytimes.test', chromeProfileDir: 'Profile 4' },
  { loginEmail: 'alma.demo@talkytimes.test', chromeProfileDir: 'Profile 5' },
  { loginEmail: 'vera.demo@talkytimes.test', chromeProfileDir: 'Profile 6' },
]);

export function validateDemoProfiles(profiles) {
  return DEMO_CREDENTIAL_TARGETS.map((target) => {
    const profile = profiles.find((candidate) => candidate.loginEmail === target.loginEmail);
    if (!profile) throw new Error(`Demo profile is missing: ${target.loginEmail}`);
    if (profile.chromeProfileDir !== target.chromeProfileDir) {
      throw new Error(`${target.loginEmail} expected ${target.chromeProfileDir}, received ${profile.chromeProfileDir}`);
    }
    if (typeof profile.id !== 'string' || !profile.id) throw new Error(`Demo profile has no id: ${target.loginEmail}`);
    return profile;
  });
}

function requestJson({ apiBase, connectHost, ca, method, path, token, body, allowedStatuses = [200, 201] }) {
  const base = new URL(apiBase);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolvePromise, reject) => {
    const request = https.request({
      hostname: connectHost,
      port: base.port || 443,
      method,
      path: `${base.pathname}${path}`,
      ca,
      servername: base.hostname,
      headers: {
        host: base.host,
        accept: 'application/json',
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        if (!allowedStatuses.includes(status)) {
          reject(Object.assign(new Error(`Station E2E API rejected ${method} ${path} with HTTP ${status}`), { status }));
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) {
          resolvePromise({ status, data: null });
          return;
        }
        try {
          resolvePromise({ status, data: JSON.parse(raw) });
        } catch {
          reject(new Error(`Station E2E API returned invalid JSON for ${method} ${path}`));
        }
      });
    });
    request.on('error', () => reject(new Error(`Station E2E API request failed for ${method} ${path}`)));
    if (payload) request.write(payload);
    request.end();
  });
}

async function main() {
  const apiBase = process.env.STATION_E2E_API_BASE_URL || REQUIRED_API_BASE;
  if (apiBase !== REQUIRED_API_BASE) throw new Error(`STATION_E2E_API_BASE_URL must be exactly ${REQUIRED_API_BASE}`);
  const connectHost = process.env.SERVER_IP?.trim();
  if (!connectHost || isIP(connectHost) !== 4) throw new Error('SERVER_IP must be an IPv4 address');
  const caPath = resolve(projectRoot, process.env.STATION_E2E_CA_FILE || '.local/station-e2e/pki/ca.crt');
  const passwordPath = resolve(projectRoot, process.env.STATION_E2E_ADMIN_PASSWORD_FILE || '.local/station-e2e/secrets/bootstrap_admin_password');
  const [ca, adminPasswordRaw] = await Promise.all([readFile(caPath), readFile(passwordPath, 'utf8')]);
  const adminPassword = adminPasswordRaw.trim();
  if (!adminPassword) throw new Error('Bootstrap administrator password file is empty');

  const call = (method, path, options = {}) => requestJson({ apiBase, connectHost, ca, method, path, ...options });
  const login = await call('POST', '/auth/login', {
    body: { email: 'admin@agency.test', password: adminPassword },
  });
  const accessToken = login.data?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Bootstrap login did not return an access token');

  const listed = await call('GET', '/profiles?page=1&pageSize=100', { token: accessToken });
  const profiles = validateDemoProfiles(Array.isArray(listed.data?.data) ? listed.data.data : []);
  let created = 0;
  let retained = 0;
  for (const profile of profiles) {
    let metadata;
    try {
      metadata = await call('GET', `/profiles/${encodeURIComponent(profile.id)}/credential/meta`, {
        token: accessToken,
        allowedStatuses: [200, 404],
      });
    } catch (error) {
      throw error;
    }
    if (metadata.status === 200) {
      retained += 1;
      continue;
    }
    const secret = randomBytes(32).toString('base64url');
    await call('PUT', `/profiles/${encodeURIComponent(profile.id)}/credential`, {
      token: accessToken,
      body: { username: profile.loginEmail, secret },
    });
    created += 1;
  }
  console.log(`Vault provisioned without plaintext output: ${created} created, ${retained} retained`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
