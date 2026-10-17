import https from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_BASE_URL = 'https://chat.globalcompany.company';

export function validateRocketChatIdentity(body, expectedUserId) {
  if (!body || body._id !== expectedUserId) throw new Error('Rocket.Chat service identity does not match the configured account');
  if (body.active !== true) throw new Error('Rocket.Chat service account is not active');
  return { id: body._id, username: typeof body.username === 'string' ? body.username : '' };
}

function readMe(baseUrl, token, userId) {
  return new Promise((resolvePromise, reject) => {
    const request = https.get(`${baseUrl}/api/v1/me`, {
      headers: { 'X-Auth-Token': token, 'X-User-Id': userId, accept: 'application/json' },
      timeout: 15_000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`Rocket.Chat GET /api/v1/me returned HTTP ${response.statusCode ?? 0}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('Rocket.Chat GET /api/v1/me returned invalid JSON'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Rocket.Chat identity check timed out')));
    request.on('error', () => reject(new Error('Rocket.Chat identity check failed')));
  });
}

async function main() {
  const baseUrl = process.env.ROCKETCHAT_BASE_URL?.replace(/\/$/, '');
  const token = process.env.ROCKETCHAT_TOKEN;
  const userId = process.env.ROCKETCHAT_USER_ID;
  if (baseUrl !== REQUIRED_BASE_URL) throw new Error(`ROCKETCHAT_BASE_URL must be exactly ${REQUIRED_BASE_URL}`);
  if (!token || token === 'NOT_CONFIGURED_WORKER_DISABLED') throw new Error('A dedicated Rocket.Chat service token is not configured');
  if (!userId || userId === 'NOT_CONFIGURED_WORKER_DISABLED') throw new Error('A dedicated Rocket.Chat service user id is not configured');
  const identity = validateRocketChatIdentity(await readMe(baseUrl, token, userId), userId);
  console.log(`Rocket.Chat read-only identity check passed for ${identity.username || identity.id}; no mutations were attempted`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
