import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { signAccessToken } from '../../common/auth/crypto.js';
import { devices, ipAllowlist, shifts } from '../../database/schema/index.js';
import { outboxEvents, rocketchatChannels, users } from '../../database/schema/index.js';
import {
  TEST_JWT_SECRET,
  createDevice,
  createTestContext,
  createUser,
  destroyTestContext,
  halfOpen,
  resetDatabase,
  seedRoles,
  type CreatedUser,
  type RoleCode,
  type TestContext,
} from '../support/harness.js';

let ctx: TestContext;
let app: NestFastifyApplication;

beforeAll(async () => {
  process.env.ROCKETCHAT_WEBHOOK_SECRET = 'http-test-webhook-secret-with-32-characters';
  process.env.ROCKETCHAT_USER_ID = 'http-test-bot';
  process.env.ROCKETCHAT_BOT_TRIGGER = 'ayuda';
  ctx = await createTestContext();
  // Vite transpiles test files without TypeScript's decorator metadata. Import
  // the build artifact so this acceptance test boots the exact Nest graph that
  // production starts, including constructor injection for every module.
  const distModuleUrl = new URL('../../../dist/app.module.js', import.meta.url).href;
  const { AppModule } = await import(/* @vite-ignore */ distModuleUrl);
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

function accessToken(user: CreatedUser, role: RoleCode, permissions: string[] = []): string {
  return signAccessToken({ sub: user.id, role, permissions }, TEST_JWT_SECRET, 60);
}

async function allowLoopback(createdBy: string): Promise<void> {
  await ctx.db.insert(ipAllowlist).values({ label: 'Nest acceptance test', cidr: '127.0.0.1/32', scope: 'ALL', createdBy });
}

function authorization(token: string, deviceToken?: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, ...(deviceToken ? { 'x-device-token': deviceToken } : {}) };
}

describe('Entrega 1 HTTP security acceptance', () => {
  it('acknowledges native Rocket.Chat webhook events and only queues valid bot messages', async () => {
    const operator = await createUser(ctx);
    await ctx.db.update(users).set({ rocketchatUserId: 'http-test-user' }).where(eq(users.id, operator.id));
    await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'http-bot-room', name: 'Ayuda bot', type: 'CHANNEL', purpose: 'BOT' });

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/rocketchat/bot/events',
      payload: { token: 'wrong-token', user_id: 'http-test-user', channel_id: 'http-bot-room', message_id: 'http-invalid', timestamp: new Date().toISOString(), text: 'ayuda turno', trigger_word: 'ayuda' },
    });
    expect(invalid.statusCode).toBe(200);
    expect(await ctx.db.select({ id: outboxEvents.id }).from(outboxEvents)).toHaveLength(0);

    const valid = await app.inject({
      method: 'POST',
      url: '/api/v1/rocketchat/bot/events',
      payload: { token: process.env.ROCKETCHAT_WEBHOOK_SECRET, user_id: 'http-test-user', channel_id: 'http-bot-room', message_id: 'http-valid', timestamp: new Date().toISOString(), text: 'ayuda turno', trigger_word: 'ayuda' },
    });
    expect(valid.statusCode).toBe(200);
    expect(await ctx.db.select({ id: outboxEvents.id }).from(outboxEvents)).toHaveLength(1);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/rocketchat/bot/events',
      payload: { token: process.env.ROCKETCHAT_WEBHOOK_SECRET, user_id: 'http-test-user', channel_id: 'http-bot-room', message_id: 'http-valid', timestamp: new Date().toISOString(), text: 'ayuda turno', trigger_word: 'ayuda' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(await ctx.db.select({ id: outboxEvents.id }).from(outboxEvents)).toHaveLength(1);

  });

  it('fails closed when the request IP is not allowlisted', async () => {
    const operator = await createUser(ctx);
    const response = await app.inject({ method: 'GET', url: '/api/v1/profiles', headers: authorization(accessToken(operator, 'OPERADOR', ['profiles.read'])) });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ message: 'IP allowlist is not configured' });
  });

  it('rejects a valid token carrying the wrong role for an agent endpoint', async () => {
    const cafeteria = await createUser(ctx, { role: 'CAFETERIA' });
    await allowLoopback(cafeteria.id);
    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/profiles/assigned', headers: authorization(accessToken(cafeteria, 'CAFETERIA', ['profiles.read'])) });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ message: 'Role is not allowed' });
  });

  it('rejects an operator outside an approved shift before device access', async () => {
    const operator = await createUser(ctx);
    await allowLoopback(operator.id);
    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/profiles/assigned', headers: authorization(accessToken(operator, 'OPERADOR', ['profiles.read'])) });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ message: 'Operator is outside an approved shift' });
  });

  it('rejects both revoked and expired devices', async () => {
    const operator = await createUser(ctx);
    await allowLoopback(operator.id);
    const now = new Date();
    await ctx.db.insert(shifts).values({
      operatorId: operator.id,
      businessDate: now.toISOString().slice(0, 10),
      scheduledRange: halfOpen(new Date(now.getTime() - 60_000), new Date(now.getTime() + 60_000)),
    });
    const revoked = await createDevice(ctx, { operatorId: operator.id, status: 'REVOKED' });
    const expired = await createDevice(ctx, { operatorId: operator.id });
    await ctx.db.update(devices).set({ tokenExpiresAt: new Date(now.getTime() - 1_000) }).where(eq(devices.id, expired.id));
    const token = accessToken(operator, 'OPERADOR', ['profiles.read']);

    for (const device of [revoked, expired]) {
      const response = await app.inject({ method: 'GET', url: '/api/v1/agent/profiles/assigned', headers: authorization(token, device.token) });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ message: 'Device token is invalid or expired' });
    }
  });

  it('rejects an authenticated token without the endpoint permission', async () => {
    const operator = await createUser(ctx);
    await allowLoopback(operator.id);
    const response = await app.inject({ method: 'GET', url: '/api/v1/profiles', headers: authorization(accessToken(operator, 'OPERADOR')) });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ message: 'Insufficient permission' });
  });
});
