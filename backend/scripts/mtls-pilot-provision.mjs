import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Provisiona el piloto mTLS usando el mismo origen interno que cloudflared:
// Caddy con el Host del piloto. No imprime secretos ni tokens.
// Reutiliza el operador y los perfiles del seed demo; solo crea el dispositivo
// y la credencial ficticia que el seed no incluye.
const API_BASE = process.env.PILOT_API_BASE || 'http://caddy/api/v1';
const HOST_HEADER = process.env.PILOT_HOST_HEADER || 'mtls-pilot.globalcompany.company';
const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@agency.test';
const AGENT_DIR = process.env.PILOT_AGENT_DIR || '/pilot-agent';
const DEMO_OPERATOR_EMAIL = 'operador@agency.test';
const PILOT_PROFILE_EMAIL = 'luna.demo@talkytimes.test';

function requestJson({ method, path, token, body, allowedStatuses = [200, 201] }) {
  const base = new URL(API_BASE);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolvePromise, reject) => {
    const request = http.request({
      hostname: base.hostname,
      port: base.port || 80,
      method,
      path: `${base.pathname}${path}`,
      headers: {
        host: HOST_HEADER,
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
          reject(Object.assign(new Error(`Pilot API rejected ${method} ${path} with HTTP ${status}`), { status }));
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
          reject(new Error(`Pilot API returned invalid JSON for ${method} ${path}`));
        }
      });
    });
    request.on('error', () => reject(new Error(`Pilot API request failed for ${method} ${path}`)));
    if (payload) request.write(payload);
    request.end();
  });
}

async function main() {
  const adminPassword = (await readFile(process.env.BOOTSTRAP_ADMIN_PASSWORD_FILE || '/run/secrets/bootstrap_admin_password', 'utf8')).trim();
  const operatorPassword = (await readFile(process.env.DEMO_USER_PASSWORD_FILE || '/run/secrets/demo_user_password', 'utf8')).trim();
  if (!adminPassword) throw new Error('Bootstrap administrator password file is empty');
  if (!operatorPassword) throw new Error('Demo user password file is empty');
  const call = (method, path, options = {}) => requestJson({ method, path, ...options });

  const login = await call('POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: adminPassword } });
  const accessToken = login.data?.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) throw new Error('Bootstrap login did not return an access token');

  const profiles = await call('GET', '/profiles?page=1&pageSize=100', { token: accessToken });
  const profile = Array.isArray(profiles.data?.data)
    ? profiles.data.data.find((candidate) => candidate.loginEmail === PILOT_PROFILE_EMAIL)
    : undefined;
  if (typeof profile?.id !== 'string') throw new Error('Demo profile Luna is missing; run seed-demo first');

  // Credencial ficticia del perfil (no es de TalkyTimes real). El seed demo no
  // escribe secretos en el vault.
  const meta = await call('GET', `/profiles/${profile.id}/credential/meta`, { token: accessToken, allowedStatuses: [200, 404] });
  if (meta.status !== 200) {
    await call('PUT', `/profiles/${profile.id}/credential`, {
      token: accessToken,
      body: { username: PILOT_PROFILE_EMAIL, secret: `piloto-${randomBytes(12).toString('base64url')}`, profileVersion: profile.version ?? 0 },
    });
  }

  // Dispositivo de ensayo con token exclusivo; queda solo en el host.
  const deviceLabel = 'mtls-pilot-pc01';
  const devices = await call('GET', '/devices', { token: accessToken });
  let device = Array.isArray(devices.data) ? devices.data.find((candidate) => candidate.label === deviceLabel) : undefined;
  let deviceToken;
  if (!device) {
    const created = await call('POST', '/devices', { token: accessToken, body: { hostname: 'mtls-pilot-pc01', label: deviceLabel } });
    const enrollmentCode = created.data?.enrollmentCode;
    if (typeof enrollmentCode !== 'string') throw new Error('Device enrollment code was not returned');
    const enrolled = await call('POST', '/devices/enroll', { body: { code: enrollmentCode, hostname: 'mtls-pilot-pc01', label: deviceLabel } });
    deviceToken = enrolled.data?.deviceToken;
    device = enrolled.data;
  } else {
    const rotated = await call('POST', `/devices/${device.id}/rotate`, { token: accessToken });
    deviceToken = rotated.data?.deviceToken;
  }
  if (typeof deviceToken !== 'string' || !deviceToken) throw new Error('Device token was not issued');

  // Material exclusivo del host, nunca del repositorio.
  const agentRoot = resolve(AGENT_DIR);
  await mkdir(agentRoot, { recursive: true });
  await writeFile(resolve(agentRoot, 'device-token.txt'), deviceToken, { encoding: 'utf8', mode: 0o600 });
  await writeFile(resolve(agentRoot, 'operator-credentials.txt'), `email=${DEMO_OPERATOR_EMAIL}\npassword=${operatorPassword}\n`, { encoding: 'utf8', mode: 0o600 });
  await writeFile(resolve(agentRoot, 'launch-info.json'), JSON.stringify({
    profileId: profile.id,
    profileName: profile.displayName,
    operatorEmail: DEMO_OPERATOR_EMAIL,
    apiBaseUrl: `https://${HOST_HEADER}/api/v1`,
    webOrigin: `https://${HOST_HEADER}`,
    agentPort: 45832,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });

  console.log(`Pilot provisioned: operator=${DEMO_OPERATOR_EMAIL}, profile=${profile.displayName}, device=${device.id ?? device.deviceId}`);
  console.log(`Agent material written under ${agentRoot} (token, operator credentials, launch info).`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
