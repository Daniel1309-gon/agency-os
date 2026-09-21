/**
 * Mide el comportamiento de un WebSocket ya abierto cuando se revoca el
 * certificado de cliente en Cloudflare.
 *
 * Fases:
 *  1. inicia sesión por HTTPS con el certificado de cliente, conecta al
 *     gateway /operations y confirma la conexión con el snapshot inicial;
 *  2. mantiene el socket abierto y hace round-trips periódicos de
 *     `operators.snapshot` con ack;
 *  3. detecta la revocación sondeando el hostname con el mismo certificado
 *     (un handshake nuevo por sonda): el primer 403 marca la revocación, y
 *     desde ahí observa si el socket ya abierto sobrevive;
 *  4. fuerza una reconexión nueva con el mismo certificado revocado y
 *     registra si Cloudflare la bloquea.
 *
 * Uso:
 *   node tools/mtls-pilot-websocket.mjs \
 *     --password-file .local/mtls-pilot/secrets/demo_user_password \
 *     --cert .local/mtls-pilot/mtls/agency-pilot-pc01-v4.crt \
 *     --key .local/mtls-pilot/mtls/agency-pilot-pc01-v4.key
 */

import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(ROOT, 'backend', 'package.json'));
const { io } = require('socket.io-client');

const HOST = 'mtls-pilot.globalcompany.company';
const ORIGIN = `https://${HOST}`;
const ROUND_TRIP_MS = 10_000;
const PROBE_MS = 5_000;
const OBSERVE_AFTER_REVOCATION_MS = 90_000;
const MAX_WAIT_REVOCATION_MS = 10 * 60_000;

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) {
    args[argv[index].replace(/^--/, '')] = argv[index + 1];
  }
  if (!args['password-file'] || !args.cert || !args.key) {
    console.error('Faltan --password-file, --cert o --key');
    process.exit(1);
  }
  return args;
}

const args = parseArgs();
const operatorPassword = readFileSync(resolve(ROOT, args['password-file']), 'utf8').trim();
const cert = readFileSync(resolve(ROOT, args.cert));
const key = readFileSync(resolve(ROOT, args.key));
const timestamp = () => new Date().toISOString();
const log = (message) => console.log(`[${timestamp()}] ${message}`);

function requestStatus(path, body) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolvePromise) => {
    const req = request({
      hostname: HOST,
      port: 443,
      path,
      method: payload ? 'POST' : 'GET',
      cert,
      key,
      headers: {
        'user-agent': 'AgencyOS-Local-Agent/0.1',
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      response.resume();
      response.on('end', () => resolvePromise(response.statusCode ?? 0));
    });
    req.on('error', () => resolvePromise(0));
    if (payload) req.write(payload);
    req.end();
  });
}

async function loginWithToken() {
  const body = JSON.stringify({ email: 'operador@agency.test', password: operatorPassword });
  return new Promise((resolvePromise, reject) => {
    const req = request({
      hostname: HOST,
      port: 443,
      path: '/api/v1/auth/login',
      method: 'POST',
      cert,
      key,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'user-agent': 'AgencyOS-Local-Agent/0.1',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode !== 201) {
          reject(new Error(`login HTTP ${response.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`));
          return;
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolvePromise(parsed.accessToken);
      });
    });
    req.on('error', (error) => reject(error));
    req.write(body);
    req.end();
  });
}

const state = {
  connected: false,
  revokedAt: null,
  lastAckAt: null,
  lastAckAfterRevocationAt: null,
  disconnectedAt: null,
  disconnectReason: null,
  reconnected: false,
};

function snapshot(socket, phase) {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise({ ok: false, reason: 'timeout' }), 15_000);
    socket.emit('operators.snapshot', (result) => {
      clearTimeout(timer);
      const ok = Array.isArray(result);
      if (ok) {
        state.lastAckAt = timestamp();
        if (state.revokedAt) state.lastAckAfterRevocationAt = timestamp();
      }
      resolvePromise({ ok, phase });
    });
  });
}

async function connect({ label, token }) {
  return new Promise((resolvePromise) => {
    const socket = io(`${ORIGIN}/operations`, {
      path: '/socket.io',
      transports: ['websocket'],
      auth: { token },
      extraHeaders: { origin: ORIGIN },
      cert,
      key,
      reconnection: false,
      timeout: 15_000,
    });
    const outcome = { socket, connected: false, error: null };
    const timer = setTimeout(() => {
      outcome.error = 'timeout';
      socket.close();
      resolvePromise(outcome);
    }, 20_000);
    socket.on('connect', async () => {
      clearTimeout(timer);
      outcome.connected = true;
      state.connected = true;
      log(`${label}: conectado (id=${socket.id})`);
      const first = await snapshot(socket, 'inicial');
      log(`${label}: snapshot inicial -> ${first.ok ? 'ok' : 'sin respuesta'}`);
      resolvePromise(outcome);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      outcome.error = `${error.message}`;
      log(`${label}: connect_error -> ${outcome.error}`);
      resolvePromise(outcome);
    });
    socket.on('disconnect', (reason) => {
      state.connected = false;
      if (!state.disconnectedAt) {
        state.disconnectedAt = timestamp();
        state.disconnectReason = reason;
      }
      log(`${label}: desconectado (${reason})`);
    });
  });
}

async function main() {
  log('iniciando sesion por HTTPS con el certificado de cliente');
  const token = await loginWithToken();
  log('sesion iniciada; conectando al gateway /operations');
  const first = await connect({ label: 'fase 1', token });
  if (!first.connected) {
    log(`no se pudo conectar: ${first.error}`);
    process.exit(2);
  }
  const socket = first.socket;

  log(`mantengo el socket abierto; round-trips cada ${ROUND_TRIP_MS / 1000}s`);
  const roundTrip = setInterval(async () => {
    const result = await snapshot(socket, 'periodico');
    if (result.ok) {
      log(`round-trip ok; revoked=${state.revokedAt ?? 'no'}`);
    } else {
      log(`round-trip sin respuesta (${result.reason})`);
    }
  }, ROUND_TRIP_MS);

  // Sonda de revocacion: cada intento es un handshake TLS nuevo con el mismo
  // certificado. Antes de revocar devuelve 200; despues, 403 de Cloudflare.
  log('esperando la revocacion (sonda cada 5s; hasta 10 min)');
  const probeDeadline = Date.now() + MAX_WAIT_REVOCATION_MS;
  let lastProbeStatus = 200;
  while (!state.revokedAt && Date.now() < probeDeadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, PROBE_MS));
    const status = await requestStatus('/healthz');
    if (status !== lastProbeStatus) {
      log(`sonda: HTTP ${status}`);
      lastProbeStatus = status;
    }
    if (status === 403) {
      state.revokedAt = timestamp();
      log(`revocacion detectada (sonda HTTP 403) a las ${state.revokedAt}`);
    }
  }
  if (!state.revokedAt) {
    log('no se detecto la revocacion dentro de la ventana; termino sin medir');
  } else {
    const observeUntil = Date.now() + OBSERVE_AFTER_REVOCATION_MS;
    while (Date.now() < observeUntil) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    }
  }

  clearInterval(roundTrip);
  log(`cierre de la fase de observacion (socket ${state.connected ? 'aun conectado' : 'caido'})`);
  socket.close();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));

  log('fase 4: intento de reconexion con el certificado revocado');
  const retry = await connect({ label: 'fase 4', token });
  if (retry.connected) {
    state.reconnected = true;
    retry.socket.close();
  }

  console.log('\nResumen WebSocket:');
  console.log(`- revocacion detectada:              ${state.revokedAt ?? 'no detectada'}`);
  console.log(`- ultimo round-trip antes:           ${state.lastAckAt ?? 'sin datos'}`);
  console.log(`- ultimo round-trip despues:         ${state.lastAckAfterRevocationAt ?? 'ninguno'}`);
  const closedByUs = state.disconnectReason === 'io client disconnect';
  console.log(`- socket ya abierto tras revocacion: ${!state.revokedAt ? 'no medido' : closedByUs ? 'SOBREVIVIO todo el periodo de observacion (lo cerro el cliente al terminar)' : state.disconnectedAt ? `cayo a las ${state.disconnectedAt} (${state.disconnectReason})` : 'seguia conectado al terminar'}`);
  console.log(`- reconexion con certificado revocado: ${state.reconnected ? 'PERMITIDA (revisar Cloudflare)' : 'BLOQUEADA'}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
