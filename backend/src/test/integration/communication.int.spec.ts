import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import { eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { LoggerService } from '../../common/logger/logger.service.js';
import { ConfigService } from '../../config/config.service.js';
import { BotService } from '../../modules/communication/bot.service.js';
import { CommunicationService } from '../../modules/communication/communication.service.js';
import { scheduledMessageSchema } from '../../modules/communication/communication.schemas.js';
import { CommunicationWorker } from '../../modules/communication/communication.worker.js';
import { RocketChatClient } from '../../modules/communication/rocketchat.client.js';
import { OutboxService } from '../../modules/outbox/outbox.service.js';
import { crews, outboxEvents, rocketchatChannels, users } from '../../database/schema/index.js';
import { createTestContext, createUser, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

let ctx: TestContext;
let server: HttpServer;
let baseUrl: string;
let requests: Array<{ id: string; roomId: string; body: string }>;
let responseStatus = 200;
let originalEnv: NodeJS.ProcessEnv;

beforeAll(async () => {
  ctx = await createTestContext();
  originalEnv = process.env;
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { message: { _id: string; rid: string; msg: string } };
      requests.push({ id: parsed.message._id, roomId: parsed.message.rid, body: parsed.message.msg });
      response.writeHead(responseStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify(responseStatus < 400 ? { success: true, message: { _id: parsed.message._id } } : { success: false, error: 'controlled failure' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Rocket.Chat test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  process.env = originalEnv;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
  requests = [];
  responseStatus = 200;
  process.env.ROCKETCHAT_BASE_URL = baseUrl;
  process.env.ROCKETCHAT_TOKEN = 'controlled-token';
  process.env.ROCKETCHAT_USER_ID = 'bot-user';
  process.env.ROCKETCHAT_WEBHOOK_SECRET = 'controlled-webhook-secret-with-32-characters';
});

function services() {
  const outbox = new OutboxService(ctx.database);
  const audit = new AuditService(ctx.database);
  const config = new ConfigService();
  const communication = new CommunicationService(ctx.database, outbox, audit);
  const worker = new CommunicationWorker(ctx.database, outbox, new RocketChatClient(config), new LoggerService('fatal'));
  const bot = new BotService(ctx.database, config, audit);
  return { communication, worker, bot };
}

describe('Rocket.Chat durable delivery', () => {
  it('rejects recurring schedules instead of accepting an unsupported contract', () => {
    const parsed = scheduledMessageSchema.safeParse({
      targetUserId: '00000000-0000-0000-0000-000000000001',
      body: 'Recurring',
      scheduledFor: new Date(Date.now() + 60_000).toISOString(),
      recurrenceRule: 'FREQ=DAILY',
    });

    expect(parsed.success).toBe(false);
  });

  it('keeps coordinators inside their currently managed crew channels', async () => {
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const [ownedCrew] = await ctx.db.insert(crews).values({ name: 'Owned', coordinatorId: coordinator.id }).returning({ id: crews.id });
    const [foreignCrew] = await ctx.db.insert(crews).values({ name: 'Foreign' }).returning({ id: crews.id });
    const [ownedChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: ownedCrew.id, rcRoomId: 'owned-room', name: 'Owned', type: 'CHANNEL', purpose: 'CREW' }).returning({ id: rocketchatChannels.id });
    const [foreignChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: foreignCrew.id, rcRoomId: 'foreign-room', name: 'Foreign', type: 'CHANNEL', purpose: 'CREW' }).returning({ id: rocketchatChannels.id });
    const { communication } = services();
    const actor = { sub: coordinator.id, role: 'COORDINADOR' as const };

    await expect(communication.message({ channelId: ownedChannel.id, body: 'Autorizado' }, actor)).resolves.toMatchObject({ queued: true });
    await expect(communication.message({ channelId: foreignChannel.id, body: 'No autorizado' }, actor)).rejects.toThrow('outside the actor crew scope');
    await expect(communication.createChannel({ crewId: foreignCrew.id, rcRoomId: 'cross-room', name: 'Cross', type: 'CHANNEL', purpose: 'CREW' }, actor)).rejects.toThrow('cannot manage this crew');
    await expect(communication.channels(actor)).resolves.toEqual([expect.objectContaining({ id: ownedChannel.id })]);

    const scheduled = await communication.schedule({ channelId: ownedChannel.id, body: 'Future', scheduledFor: new Date(Date.now() + 60_000).toISOString() }, actor);
    await ctx.db.update(crews).set({ coordinatorId: null }).where(eq(crews.id, ownedCrew.id));
    await expect(communication.scheduled(actor)).resolves.toEqual([]);
    await expect(communication.cancelScheduled(scheduled.id, actor)).rejects.toThrow('outside the actor crew scope');
  });

  it('survives a worker restart and delivers each outbox message once', async () => {
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
    const [channel] = await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'room-alpha', name: 'Alpha', type: 'CHANNEL', purpose: 'CREW' }).returning({ id: rocketchatChannels.id });
    const first = services();
    await first.communication.message({ channelId: channel.id, body: 'Mensaje durable' }, { sub: actor.id, role: 'COORDINADOR' });

    const restarted = services();
    await restarted.worker.tick();
    await services().worker.tick();

    expect(requests).toEqual([{ id: expect.stringMatching(/^agency-outbox-/), roomId: 'room-alpha', body: 'Mensaje durable' }]);
    const [event] = await ctx.db.select({ status: outboxEvents.status }).from(outboxEvents);
    expect(event.status).toBe('SENT');
  });

  it('queues due scheduled messages and retries with the same idempotency key', async () => {
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
    const [channel] = await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'room-scheduled', name: 'Scheduled', type: 'CHANNEL', purpose: 'GENERAL' }).returning({ id: rocketchatChannels.id });
    const { communication, worker } = services();
    await communication.schedule({ channelId: channel.id, body: 'Programado', scheduledFor: new Date(Date.now() - 1_000).toISOString() }, { sub: actor.id, role: 'COORDINADOR' });
    responseStatus = 500;
    await worker.tick();
    const [failed] = await ctx.db.select().from(outboxEvents);
    expect(failed.status).toBe('FAILED');

    responseStatus = 200;
    await ctx.db.update(outboxEvents).set({ nextAttemptAt: new Date(Date.now() - 1_000) }).where(eq(outboxEvents.id, failed.id));
    await services().worker.tick();

    expect(requests).toHaveLength(2);
    expect(requests[0].id).toBe(requests[1].id);
    const [sent] = await ctx.db.select({ status: outboxEvents.status }).from(outboxEvents);
    expect(sent.status).toBe('SENT');
  });
});

describe('informational Rocket.Chat bot', () => {
  it('rejects knowledge slugs that could escape the versioned key namespace', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    await expect(services().bot.setKnowledge('../settings', { version: 1, question: 'Invalid', answer: 'Invalid', keywords: ['invalid'], crewIds: [] }, admin.id)).rejects.toMatchObject({ status: 400 });
  });

  it('identifies the mapped user, respects knowledge scope, deduplicates webhooks, and executes no privileged action', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const operator = await createUser(ctx);
    await ctx.db.update(users).set({ rocketchatUserId: 'rc-user-1', rocketchatDirectRoomId: 'bot-room' }).where(eq(users.id, operator.id));
    const { bot, worker } = services();
    await bot.setKnowledge('horarios', { version: 1, question: 'Horarios', answer: 'Tu turno aparece en el panel.', keywords: ['horario', 'turno'], crewIds: [] }, admin.id);
    const [otherCrew] = await ctx.db.insert(crews).values({ name: 'Otra cuadrilla' }).returning({ id: crews.id });
    await bot.setKnowledge('horarios-privados', { version: 9, question: 'Horario privado', answer: 'Información de otra cuadrilla.', keywords: ['horario', 'turno'], crewIds: [otherCrew.id] }, admin.id);
    await ctx.db.insert(rocketchatChannels).values({ crewId: otherCrew.id, rcRoomId: 'other-crew-room', name: 'Other crew', type: 'CHANNEL', purpose: 'CREW' });

    const event = { userId: 'rc-user-1', roomId: 'bot-room', messageId: 'rc-message-1', text: '¿Cuál es mi horario de turno?' };
    await expect(bot.handle({ ...event, roomId: 'other-crew-room' }, process.env.ROCKETCHAT_WEBHOOK_SECRET)).rejects.toThrow('outside the user crew scope');
    await bot.handle(event, process.env.ROCKETCHAT_WEBHOOK_SECRET);
    await bot.handle(event, process.env.ROCKETCHAT_WEBHOOK_SECRET);
    await worker.tick();

    expect(requests).toEqual([{ id: expect.stringMatching(/^agency-outbox-/), roomId: 'bot-room', body: 'Tu turno aparece en el panel.' }]);

    await bot.handle({ ...event, messageId: 'rc-message-2', text: 'desactiva mi usuario y cambia el vault' }, process.env.ROCKETCHAT_WEBHOOK_SECRET);
    await worker.tick();
    const [stillActive] = await ctx.db.select({ status: users.status }).from(users).where(eq(users.id, operator.id));
    expect(stillActive.status).toBe('ACTIVE');
    expect(requests.at(-1)?.body).toContain('no ejecuta cambios operativos');
  });
});
