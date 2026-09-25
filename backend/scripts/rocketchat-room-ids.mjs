import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lee de Rocket.Chat el id de una sala privada y el de cada uno de sus miembros, que es
 * lo que hace falta para registrar el canal con proposito BOT y vincular
 * users.rocketchat_user_id en Agency OS.
 *
 * Usa un login temporal de administrador y cierra sesion al terminar, en vez de un PAT
 * administrativo permanente: el token muere con el logout y no queda nada que revocar.
 * No imprime el token ni lo escribe en ningun sitio.
 *
 * Uso:
 *   ROCKETCHAT_ADMIN_USER=... ROCKETCHAT_ADMIN_PASSWORD=... \
 *   node --env-file=backend/.env backend/scripts/rocketchat-room-ids.mjs ayuda-bot
 */

const TIMEOUT_MS = 15_000;

export function toMemberRows(members) {
  if (!Array.isArray(members)) throw new Error('Rocket.Chat returned no member list');
  return members
    .map((member) => ({
      username: typeof member?.username === 'string' ? member.username : '',
      name: typeof member?.name === 'string' ? member.name : '',
      id: typeof member?._id === 'string' ? member._id : '',
    }))
    .filter((row) => row.id !== '' && row.username !== '')
    .sort((left, right) => left.username.localeCompare(right.username));
}

export function readRoomId(body) {
  const id = body?.group?._id;
  if (typeof id !== 'string' || id === '') throw new Error('Rocket.Chat did not return a private room with that name');
  return id;
}

async function call(baseUrl, path, { method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success === false) {
    // Se propaga errorType, que es un codigo corto de Rocket.Chat y dice que fallo
    // (por ejemplo totp-required). El campo message no, porque puede repetir lo enviado.
    const reason = typeof payload?.errorType === 'string' && payload.errorType !== '' ? ` (${payload.errorType})` : '';
    throw new Error(`Rocket.Chat ${method} ${path} returned HTTP ${response.status}${reason}`);
  }
  return payload;
}

async function main() {
  const roomName = process.argv[2];
  if (!roomName) throw new Error('Pass the private room name, for example: ayuda-bot');
  const baseUrl = process.env.ROCKETCHAT_BASE_URL?.replace(/\/$/, '');
  const user = process.env.ROCKETCHAT_ADMIN_USER;
  const password = process.env.ROCKETCHAT_ADMIN_PASSWORD;
  if (!baseUrl) throw new Error('ROCKETCHAT_BASE_URL is not configured');
  if (!user || !password) throw new Error('Set ROCKETCHAT_ADMIN_USER and ROCKETCHAT_ADMIN_PASSWORD for this one-off lookup');

  const login = await call(baseUrl, '/api/v1/login', { method: 'POST', body: { user, password } });
  const token = login?.data?.authToken;
  const userId = login?.data?.userId;
  if (!token || !userId) throw new Error('Rocket.Chat login did not return a session');
  const auth = { 'X-Auth-Token': token, 'X-User-Id': userId };

  try {
    const roomId = readRoomId(await call(baseUrl, `/api/v1/groups.info?roomName=${encodeURIComponent(roomName)}`, { headers: auth }));
    const rows = toMemberRows((await call(baseUrl, `/api/v1/groups.members?roomId=${encodeURIComponent(roomId)}&count=100`, { headers: auth }))?.members);

    console.log(`\nSala #${roomName}`);
    console.log(`  rcRoomId: ${roomId}\n`);
    console.log(`Miembros (${rows.length}):`);
    for (const row of rows) console.log(`  ${row.username.padEnd(24)} ${row.id.padEnd(20)} ${row.name}`);
    console.log('');
  } finally {
    await call(baseUrl, '/api/v1/logout', { method: 'POST', headers: auth }).catch(() => undefined);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Rocket.Chat lookup failed');
    process.exitCode = 1;
  });
}
