import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import Redis from 'ioredis';
import { signAccessToken } from '../../common/auth/crypto.js';
import { RedisIoAdapter } from '../../modules/realtime/redis-io.adapter.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';
import { ipAllowlist, shifts } from '../../database/schema/index.js';
import {
  TEST_JWT_SECRET,
  createDevice,
  createTestContext,
  createUser,
  destroyTestContext,
  halfOpen,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

interface OperatorSnapshot {
  operatorId: string;
  status: string;
  reason: string;
}

let ctx: TestContext;
let first: NestFastifyApplication;
let second: NestFastifyApplication;
let client: ClientSocket;
let adminToken: string;
let operatorToken: string;
let operatorId: string;

async function startApi(): Promise<NestFastifyApplication> {
  const distModuleUrl = new URL('../../../dist/app.module.js', import.meta.url).href;
  const distConfigUrl = new URL('../../../dist/config/config.service.js', import.meta.url).href;
  const { AppModule } = await import(/* @vite-ignore */ distModuleUrl);
  const { ConfigService: DistConfigService } = await import(/* @vite-ignore */ distConfigUrl);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  const adapter = new RedisIoAdapter(app, app.get(DistConfigService));
  await adapter.connect();
  app.useWebSocketAdapter(adapter);
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  return app;
}

function waitForSnapshot(socket: ClientSocket): Promise<OperatorSnapshot[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for operator snapshot')), 2_000);
    socket.once('operators.snapshot', (snapshot: OperatorSnapshot[]) => {
      clearTimeout(timeout);
      resolve(snapshot);
    });
  });
}

function connect(url: string, token = adminToken, extraHeaders: Record<string, string> = {}): { socket: ClientSocket; snapshot: Promise<OperatorSnapshot[]> } {
  const socket = createClient(`${url}/operations`, {
    autoConnect: false,
    forceNew: true,
    transports: ['websocket'],
    auth: { token },
    extraHeaders: { origin: 'http://localhost:5173', ...extraHeaders },
  });
  const snapshot = waitForSnapshot(socket);
  socket.connect();
  return { socket, snapshot };
}

/**
 * Pub/sub no persiste: un evento emitido mientras Redis reconecta puede perderse.
 * Reintenta el disparador hasta que un evento que cumpla `match` llega al socket.
 */
async function retryUntilEvent(
  socket: ClientSocket,
  trigger: (attempt: number) => Promise<unknown>,
  match: (event: OperatorSnapshot) => boolean,
  deadlineMs = 10_000,
): Promise<void> {
  const startedAt = performance.now();
  for (let attempt = 1; performance.now() - startedAt < deadlineMs; attempt++) {
    const received = new Promise<boolean>((resolve) => {
      const onEvent = (event: OperatorSnapshot) => {
        if (!match(event)) return;
        clearTimeout(timeout);
        socket.off('operator.status.changed', onEvent);
        resolve(true);
      };
      const timeout = setTimeout(() => {
        socket.off('operator.status.changed', onEvent);
        resolve(false);
      }, 500);
      socket.on('operator.status.changed', onEvent);
    });
    await trigger(attempt);
    if (await received) return;
  }
  throw new Error(`Realtime did not recover within ${deadlineMs} ms`);
}

function waitForDisconnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for server-side disconnect')), 5_000);
    socket.once('disconnect', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

beforeAll(async () => {
  ctx = await createTestContext();
  await resetDatabase(ctx);
  await seedRoles(ctx);
  const admin = await createUser(ctx, { role: 'ADMIN' });
  const operator = await createUser(ctx, { role: 'OPERADOR' });
  operatorId = operator.id;
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', permissions: ['operators.monitor', 'users.disable', 'devices.manage'], av: 1 }, TEST_JWT_SECRET, 60);
  operatorToken = signAccessToken({ sub: operator.id, role: 'OPERADOR', permissions: [], av: 1 }, TEST_JWT_SECRET, 60);
  await ctx.db.insert(ipAllowlist).values({ label: 'Two-instance acceptance', cidr: '127.0.0.1/32', scope: 'ALL', createdBy: admin.id });
  const now = new Date();
  await ctx.db.insert(shifts).values({
    operatorId: operator.id,
    businessDate: now.toISOString().slice(0, 10),
    scheduledRange: halfOpen(new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000)),
  });
  first = await startApi();
  second = await startApi();
});

afterAll(async () => {
  client?.close();
  await Promise.all([first?.close(), second?.close()]);
  await destroyTestContext(ctx);
});

describe('two-instance realtime semaphore', () => {
  it('propagates in under 500 ms and recovers through snapshots after reconnecting', async () => {
    const connected = connect(await second.getUrl());
    client = connected.socket;
    await expect(connected.snapshot).resolves.toEqual([
      expect.objectContaining({ operatorId, status: 'OFFLINE' }),
    ]);

    const changed = new Promise<OperatorSnapshot>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for cross-instance event')), 2_000);
      client.once('operator.status.changed', (event: OperatorSnapshot) => {
        clearTimeout(timeout);
        resolve(event);
      });
    });
    const startedAt = performance.now();
    const response = await first.inject({
      method: 'POST',
      url: '/api/v1/operators/me/status',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: { status: 'ALERT', reason: 'LOGIN_FAILED' },
    });
    expect(response.statusCode).toBe(201);
    await expect(changed).resolves.toMatchObject({ operatorId, status: 'ALERT', reason: 'LOGIN_FAILED' });
    expect(performance.now() - startedAt).toBeLessThan(500);

    client.close();
    const httpSnapshot = await second.inject({
      method: 'GET',
      url: '/api/v1/operators/status',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(httpSnapshot.statusCode).toBe(200);
    expect(httpSnapshot.json()).toEqual([expect.objectContaining({ operatorId, status: 'ALERT' })]);

    const reconnected = connect(await second.getUrl());
    client = reconnected.socket;
    await expect(reconnected.snapshot).resolves.toEqual([expect.objectContaining({ operatorId, status: 'ALERT' })]);
  });

  it('recovers cross-instance events, the worker bridge and auth limits after Redis drops every connection', async () => {
    const connected = connect(await second.getUrl());
    client = connected.socket;
    await connected.snapshot;

    // Lo que ven las APIs cuando Redis se reinicia: se cortan todas sus conexiones,
    // incluidas las de pub/sub del adaptador socket.io y del puente del worker.
    const redisAdmin = new Redis(ctx.config.get('REDIS_URL'));
    try {
      await redisAdmin.client('KILL', 'TYPE', 'normal');
      // Dos APIs × (suscriptor del adaptador + suscriptor del puente).
      expect(Number(await redisAdmin.client('KILL', 'TYPE', 'pubsub'))).toBeGreaterThanOrEqual(4);
    } finally {
      redisAdmin.disconnect();
    }

    await retryUntilEvent(client, async (attempt) => {
      const response = await first.inject({
        method: 'POST',
        url: '/api/v1/operators/me/status',
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { status: 'ALERT', reason: `REDIS_RECOVERY_${attempt}` },
      });
      expect(response.statusCode).toBe(201);
    }, (event) => event.reason.startsWith('REDIS_RECOVERY_'));

    const worker = new RealtimeService(ctx.database, ctx.redis);
    await retryUntilEvent(client, () => worker.publishOperatorChanged(operatorId), (event) => event.operatorId === operatorId);

    // El límite de login vuelve a leer Redis: credenciales malas dan 401, no 503.
    const login = await first.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@agency-os.test', password: 'not-the-password' },
    });
    expect(login.statusCode).toBe(401);
    expect(client.connected).toBe(true);
    client.close();
  });

  it('rejects a token whose authorization version is stale', async () => {
    const staleToken = signAccessToken({ sub: operatorId, role: 'OPERADOR', permissions: [], av: 0 }, TEST_JWT_SECRET, 60);
    const socket = createClient(`${await second.getUrl()}/operations`, {
      autoConnect: false,
      forceNew: true,
      transports: ['websocket'],
      auth: { token: staleToken },
      extraHeaders: { origin: 'http://localhost:5173' },
    });
    const closed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Stale authorization version stayed connected')), 3_000);
      const finish = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.once('connect_error', finish);
      socket.once('disconnect', finish);
    });
    socket.connect();
    await expect(closed).resolves.toBeUndefined();
    socket.close();
  });

  it('closes the operator socket when the user is disabled from another instance', async () => {
    const connected = connect(await second.getUrl(), operatorToken);
    client = connected.socket;
    await connected.snapshot;
    const closed = waitForDisconnect(client);

    const response = await first.inject({
      method: 'POST',
      url: `/api/v1/users/${operatorId}/disable`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(response.statusCode).toBe(201);
    await expect(closed).resolves.toBeUndefined();
  });

  it('delivers events published by a server-less worker through the Redis bridge', async () => {
    // Cada API recibe el bridge, pero su emisión debe quedarse en sus propios sockets.
    const worker = new RealtimeService(ctx.database, ctx.redis);
    const connectedFirst = connect(await first.getUrl());
    const connectedSecond = connect(await second.getUrl());
    client = connectedSecond.socket;
    await Promise.all([connectedFirst.snapshot, connectedSecond.snapshot]);
    const firstEvents: OperatorSnapshot[] = [];
    const secondEvents: OperatorSnapshot[] = [];
    connectedFirst.socket.on('operator.status.changed', (event: OperatorSnapshot) => firstEvents.push(event));
    connectedSecond.socket.on('operator.status.changed', (event: OperatorSnapshot) => secondEvents.push(event));
    await worker.publishOperatorChanged(operatorId);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(firstEvents).toEqual([expect.objectContaining({ operatorId, status: expect.any(String) })]);
    expect(secondEvents).toEqual([expect.objectContaining({ operatorId, status: expect.any(String) })]);
    connectedFirst.socket.close();
    client.close();
  });

  it('closes sockets bound to a revoked device', async () => {
    const device = await createDevice(ctx);
    const connected = connect(await second.getUrl(), adminToken, { 'client-cert': device.header });
    client = connected.socket;
    await connected.snapshot;
    const closed = waitForDisconnect(client);

    const response = await first.inject({
      method: 'POST',
      url: `/api/v1/devices/${device.id}/revoke`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { reason: 'E2E_REVOKE' },
    });
    expect(response.statusCode).toBe(201);
    await expect(closed).resolves.toBeUndefined();
  });
});
