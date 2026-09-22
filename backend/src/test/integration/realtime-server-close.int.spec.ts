import 'reflect-metadata';
// Lifetime corto: el gateway lee estas variables al cargar el modulo de dist.
process.env.SOCKET_LIFETIME_MIN_MS = '400';
process.env.SOCKET_LIFETIME_JITTER_MS = '100';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { signAccessToken } from '../../common/auth/crypto.js';
import { RedisIoAdapter } from '../../modules/realtime/redis-io.adapter.js';
import { ipAllowlist } from '../../database/schema/index.js';
import {
  TEST_JWT_SECRET,
  createTestContext,
  createUser,
  destroyTestContext,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

interface OperatorSnapshot {
  operatorId: string;
  status: string;
}

let ctx: TestContext;
let app: NestFastifyApplication;
let adminToken: string;

async function startApi(): Promise<NestFastifyApplication> {
  const distModuleUrl = new URL('../../../dist/app.module.js', import.meta.url).href;
  const distConfigUrl = new URL('../../../dist/config/config.service.js', import.meta.url).href;
  const { AppModule } = await import(/* @vite-ignore */ distModuleUrl);
  const { ConfigService: DistConfigService } = await import(/* @vite-ignore */ distConfigUrl);
  const instance = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  const adapter = new RedisIoAdapter(instance, instance.get(DistConfigService));
  await adapter.connect();
  instance.useWebSocketAdapter(adapter);
  instance.setGlobalPrefix('api/v1');
  await instance.listen(0, '127.0.0.1');
  return instance;
}

function nextSnapshot(socket: ClientSocket): Promise<OperatorSnapshot[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for operators.snapshot')), 3_000);
    socket.once('operators.snapshot', (snapshot: OperatorSnapshot[]) => {
      clearTimeout(timeout);
      resolve(snapshot);
    });
  });
}

beforeAll(async () => {
  ctx = await createTestContext();
  await resetDatabase(ctx);
  await seedRoles(ctx);
  const admin = await createUser(ctx, { role: 'ADMIN' });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', permissions: ['operators.monitor'], av: 1 }, TEST_JWT_SECRET, 60);
  await ctx.db.insert(ipAllowlist).values({ label: 'Server-close reconnect', cidr: '127.0.0.1/32', scope: 'ALL', createdBy: admin.id });
  app = await startApi();
});

afterAll(async () => {
  await app?.close();
  await destroyTestContext(ctx);
});

describe('server-initiated socket close', () => {
  it('reconnects the same client socket and receives a fresh snapshot', async () => {
    const url = await app.getUrl();
    const socket = createClient(`${url}/operations`, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token: adminToken },
      extraHeaders: { origin: 'http://localhost:5173' },
      reconnection: true,
      reconnectionDelay: 50,
      reconnectionDelayMax: 200,
      randomizationFactor: 0.5,
    });

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const snapshots: OperatorSnapshot[][] = [];
    socket.on('operators.snapshot', (snapshot: OperatorSnapshot[]) => {
      snapshots.push(snapshot);
    });
    socket.on('disconnect', (reason: string) => {
      // Mismo patron que los clientes web: "io server disconnect" no auto-reconecta.
      if (reason !== 'io server disconnect' || disposed) return;
      reconnectTimer = setTimeout(() => {
        if (!disposed && socket.disconnected) socket.connect();
      }, 50);
    });

    const firstSnapshot = nextSnapshot(socket);
    socket.connect();
    await expect(firstSnapshot).resolves.toEqual(expect.any(Array));

    // El lifetime del gateway (400-500 ms en esta prueba) cierra el socket a proposito.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for io server disconnect')), 3_000);
      let sawServerClose = false;
      socket.on('disconnect', (reason: string) => {
        if (reason === 'io server disconnect' && !sawServerClose) {
          sawServerClose = true;
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const secondSnapshot = nextSnapshot(socket);
    await expect(secondSnapshot).resolves.toEqual(expect.any(Array));
    expect(socket.connected).toBe(true);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);

    disposed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket.close();
  });

  it('recovers a socket whose JWT expired by refreshing the session before reconnecting', async () => {
    const url = await app.getUrl();
    const operator = await createUser(ctx);
    const loginResponse = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: operator.email, password: operator.password }),
    });
    expect(loginResponse.status, await loginResponse.clone().text()).toBe(201);
    const refreshToken = /agency_refresh=([^;]+)/.exec(loginResponse.headers.get('set-cookie') ?? '')?.[1];
    expect(refreshToken).toBeTruthy();

    // Token que vence enseguida: el gateway cierra el socket cuando expira.
    const shortToken = signAccessToken({ sub: operator.id, role: 'OPERADOR', permissions: [], av: 1 }, TEST_JWT_SECRET, 1);
    const socket = createClient(`${url}/operations`, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token: shortToken },
      extraHeaders: { origin: 'http://localhost:5173' },
      reconnection: false,
    });
    const firstSnapshot = nextSnapshot(socket);
    socket.connect();
    await expect(firstSnapshot).resolves.toEqual(expect.any(Array));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for io server disconnect')), 5_000);
      socket.on('disconnect', (reason: string) => {
        if (reason === 'io server disconnect') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    // Con el token vencido el servidor no entrega snapshot: hay que renovar.
    const expired = createClient(`${url}/operations`, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token: shortToken },
      extraHeaders: { origin: 'http://localhost:5173' },
      reconnection: false,
    });
    const expiredSnapshot = nextSnapshot(expired).then(() => true).catch(() => false);
    expired.connect();
    await expect(Promise.race([expiredSnapshot, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000))])).resolves.toBe(false);
    expired.close();

    const refreshed = await fetch(`${url}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    expect(refreshed.status, await refreshed.clone().text()).toBe(201);
    const { accessToken } = (await refreshed.json()) as { accessToken: string };

    const recovered = createClient(`${url}/operations`, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token: accessToken },
      extraHeaders: { origin: 'http://localhost:5173' },
      reconnection: false,
    });
    const recoveredSnapshot = nextSnapshot(recovered);
    recovered.connect();
    await expect(recoveredSnapshot).resolves.toEqual(expect.any(Array));
    recovered.close();
  });
});
