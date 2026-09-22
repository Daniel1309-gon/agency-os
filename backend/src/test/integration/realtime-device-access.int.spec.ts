import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { io as createClient } from 'socket.io-client';
import { signAccessToken } from '../../common/auth/crypto.js';
import { RedisIoAdapter } from '../../modules/realtime/redis-io.adapter.js';
import {
  TEST_JWT_SECRET,
  createDevice,
  createTestContext,
  createUser,
  destroyTestContext,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let app: NestFastifyApplication;

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

beforeAll(async () => {
  ctx = await createTestContext();
  await resetDatabase(ctx);
  await seedRoles(ctx);
  // A propósito: sin ninguna fila en ip_allowlist. El certificado es la puerta.
  app = await startApi();
});

afterAll(async () => {
  await app?.close();
  await destroyTestContext(ctx);
});

describe('WebSocket access with device certificates (ADR 0014)', () => {
  it('accepts a socket with an approved device certificate without an allowlist', async () => {
    const operator = await createUser(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });
    const token = signAccessToken({ sub: operator.id, role: 'OPERADOR', permissions: [], av: 1 }, TEST_JWT_SECRET, 60);
    const url = await app.getUrl();
    const socket = createClient(`${url}/operations`, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token },
      extraHeaders: { origin: 'http://localhost:5173', 'client-cert': device.header },
      reconnection: false,
    });
    const snapshot = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for operators.snapshot')), 3_000);
      socket.once('operators.snapshot', (payload: unknown) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
    socket.connect();

    await expect(snapshot).resolves.toEqual(expect.any(Array));
    expect(socket.connected).toBe(true);
    socket.close();
  });

  it('denies a socket without device certificate when no allowlist exists', async () => {
    const operator = await createUser(ctx);
    const token = signAccessToken({ sub: operator.id, role: 'OPERADOR', permissions: [], av: 1 }, TEST_JWT_SECRET, 60);
    const url = await app.getUrl();
    const socket = createClient(`${url}/operations`, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token },
      extraHeaders: { origin: 'http://localhost:5173' },
      reconnection: false,
    });
    const denied = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 2_000);
      socket.once('disconnect', () => {
        clearTimeout(timeout);
        resolve(true);
      });
      socket.once('connect_error', () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
    socket.connect();

    await expect(denied).resolves.toBe(true);
    socket.close();
  });
});
