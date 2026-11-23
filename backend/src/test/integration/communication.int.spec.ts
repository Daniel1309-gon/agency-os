import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createServer, type Server as HttpServer } from 'node:http';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { LoggerService } from '../../common/logger/logger.service.js';
import { ConfigService } from '../../config/config.service.js';
import { BotService } from '../../modules/communication/bot.service.js';
import { FaqBotAnswerProvider } from '../../modules/communication/bot-answer.provider.js';
import { CommunicationService } from '../../modules/communication/communication.service.js';
import { scheduledMessageSchema } from '../../modules/communication/communication.schemas.js';
import { CommunicationWorker } from '../../modules/communication/communication.worker.js';
import { businessDateInBogota, shiftBusinessDate, weekdayForBusinessDate } from '../../modules/jobs/shift-schedule.js';
import { RocketChatClient } from '../../modules/communication/rocketchat.client.js';
import { OutboxService } from '../../modules/outbox/outbox.service.js';
import { OutboxOpsRepository } from '../../modules/outbox/outbox-ops.drizzle-repository.js';
import { OutboxOpsService } from '../../modules/outbox/outbox-ops.service.js';
import { auditLog, crewMembers, crews, outboxEvents, rocketchatChannels, scheduledMessages, users } from '../../database/schema/index.js';
import { createTestContext, createUser, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

let ctx: TestContext;
let server: HttpServer;
let baseUrl: string;
let requests: Array<{ id: string; roomId: string; body: string }>;
let memberListRequests: Array<{ method: string; url: string }>;
let roomMembersByRoom: Record<string, Array<{ _id: string; username?: string; name?: string }>>;
let responseStatus = 200;
let originalEnv: NodeJS.ProcessEnv;

beforeAll(async () => {
  ctx = await createTestContext();
  originalEnv = process.env;
  server = createServer((request, response) => {
    if (request.method === 'GET' && request.url && (request.url.startsWith('/api/v1/groups.members') || request.url.startsWith('/api/v1/channels.members'))) {
      memberListRequests.push({ method: request.method, url: request.url });
      const parsedUrl = new URL(request.url, 'http://127.0.0.1');
      const roomId = parsedUrl.searchParams.get('roomId') ?? '';
      const count = Number(parsedUrl.searchParams.get('count') ?? '100');
      const offset = Number(parsedUrl.searchParams.get('offset') ?? '0');
      const all = roomMembersByRoom[roomId] ?? [];
      const slice = all.slice(offset, offset + count);
      response.writeHead(responseStatus, { 'content-type': 'application/json' });
      response.end(JSON.stringify(responseStatus < 400 ? { success: true, members: slice, count: slice.length, offset, total: all.length } : { success: false, error: 'controlled failure' }));
      return;
    }
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
  memberListRequests = [];
  roomMembersByRoom = {};
  responseStatus = 200;
  process.env.ROCKETCHAT_BASE_URL = baseUrl;
  process.env.ROCKETCHAT_TOKEN = 'controlled-token';
  process.env.ROCKETCHAT_USER_ID = 'bot-user';
  process.env.ROCKETCHAT_WEBHOOK_SECRET = 'controlled-webhook-secret-with-32-characters';
  process.env.ROCKETCHAT_BOT_TRIGGER = 'ayuda';
});

function services() {
  const outbox = new OutboxService(ctx.database);
  const audit = new AuditService(ctx.database);
  const config = new ConfigService();
  const rocketchat = new RocketChatClient(config);
  const communication = new CommunicationService(ctx.database, outbox, audit, rocketchat);
  const worker = new CommunicationWorker(ctx.database, outbox, rocketchat, new LoggerService('fatal'), config);
  const bot = new BotService(ctx.database, config, audit, ctx.redis, new FaqBotAnswerProvider());
  return { communication, worker, bot };
}

function stableBotAuditMetadata(rows: Array<{ metadata: unknown }>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.latencyMs).toEqual(expect.any(Number));
    const { latencyMs: _latencyMs, ...stable } = metadata;
    return stable;
  }).sort((left, right) => String(left.outcome).localeCompare(String(right.outcome)));
}

describe('Rocket.Chat durable delivery', () => {
  it('accepts a structured recurrence rule and rejects a free-form one', () => {
    // Miercoles 23 sep 2026, 09:05 en Bogota.
    const base = { targetUserId: '7d0f4f4e-2b1c-4c3a-9f6e-1a2b3c4d5e6f', body: 'Recurring', scheduledFor: '2026-09-23T14:05:00.000Z' };

    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: { frequency: 'DAILY' } }).success).toBe(true);
    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: { frequency: 'WEEKLY', weekdays: [1, 3] } }).success).toBe(true);
    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: 'FREQ=DAILY' }).success).toBe(false);
    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: { frequency: 'WEEKLY' } }).success).toBe(false);
    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: { frequency: 'DAILY', weekdays: [1] } }).success).toBe(false);
    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: { frequency: 'DAILY', until: '23/09/2026' } }).success).toBe(false);
    // La primera ocurrencia tiene que caer en un dia elegido y no despues de until.
    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: { frequency: 'WEEKLY', weekdays: [1] } }).success).toBe(false);
    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: { frequency: 'DAILY', until: '2026-09-22' } }).success).toBe(false);
    expect(scheduledMessageSchema.safeParse({ ...base, recurrenceRule: { frequency: 'DAILY', until: '2026-09-23' } }).success).toBe(true);
    // 23:30 del martes en Bogota ya es miercoles en UTC: cuenta el dia local.
    expect(scheduledMessageSchema.safeParse({ ...base, scheduledFor: '2026-09-23T04:30:00.000Z', recurrenceRule: { frequency: 'WEEKLY', weekdays: [2] } }).success).toBe(true);
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

  it('requeues a DEAD scheduled message from the ops surface and delivers it (E1-05)', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const [channel] = await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'room-dead', name: 'Dead letter', type: 'CHANNEL', purpose: 'GENERAL' }).returning({ id: rocketchatChannels.id });
    const { communication, worker } = services();
    const ops = new OutboxOpsService(new OutboxOpsRepository(ctx.database), ctx.database, new AuditService(ctx.database));
    const scheduled = await communication.schedule({ channelId: channel.id, body: 'Aviso que murio', scheduledFor: new Date(Date.now() - 1_000).toISOString() }, { sub: admin.id, role: 'ADMIN' });
    responseStatus = 500;
    await worker.tick();
    // Octavo intento: el worker lo da por perdido.
    await ctx.db.update(outboxEvents).set({ attempts: 7, nextAttemptAt: new Date(Date.now() - 1_000) });
    await worker.tick();
    const [dead] = await ctx.db.select({ id: outboxEvents.id, status: outboxEvents.status }).from(outboxEvents);
    expect(dead.status).toBe('DEAD');
    const messageStatus = async () => (await ctx.db.select({ status: scheduledMessages.status }).from(scheduledMessages).where(eq(scheduledMessages.id, scheduled.id)))[0].status;
    expect(await messageStatus()).toBe('FAILED');

    const listed = await ops.list({ status: 'DEAD' });
    expect(listed.data).toEqual([expect.objectContaining({ id: dead.id, eventType: 'rocketchat.message.send', aggregateType: 'scheduled_message', attempts: 8, lastError: expect.any(String) })]);
    expect(listed.data[0]).not.toHaveProperty('payload');
    expect((await ops.summary()).byStatus).toEqual([{ status: 'DEAD', count: 1 }]);

    await expect(ops.requeue(String(dead.id), admin.id)).resolves.toEqual({ id: dead.id, status: 'PENDING' });
    expect(await messageStatus()).toBe('QUEUED');
    await expect(ops.requeue(String(dead.id), admin.id)).rejects.toThrow(ConflictException);
    await expect(ops.requeue('999999', admin.id)).rejects.toThrow(NotFoundException);

    responseStatus = 200;
    await services().worker.tick();

    const [sent] = await ctx.db.select({ status: outboxEvents.status, attempts: outboxEvents.attempts }).from(outboxEvents);
    expect(sent).toEqual({ status: 'SENT', attempts: 1 });
    expect(await messageStatus()).toBe('SENT');
    const audit = await ctx.db.select({ actorUserId: auditLog.actorUserId, metadata: auditLog.metadata }).from(auditLog).where(eq(auditLog.action, 'outbox.requeued'));
    expect(audit).toEqual([{ actorUserId: admin.id, metadata: expect.objectContaining({ eventId: dead.id, eventType: 'rocketchat.message.send', aggregateType: 'scheduled_message', fromStatus: 'DEAD' }) }]);
  });

  it('pages the outbox list by id and rejects an invalid filter', async () => {
    const outbox = new OutboxService(ctx.database);
    const ids = [];
    for (let index = 0; index < 3; index += 1) ids.push(await outbox.enqueue('rocketchat.message.send', 'manual', undefined, { roomId: 'r', body: `m${index}` }));
    const ops = new OutboxOpsService(new OutboxOpsRepository(ctx.database), ctx.database, new AuditService(ctx.database));

    const first = await ops.list({ limit: '2' });
    expect(first.data.map((row) => row.id)).toEqual([ids[2], ids[1]]);
    const second = await ops.list({ limit: '2', cursor: first.pagination.nextCursor ?? undefined });
    expect(second.data.map((row) => row.id)).toEqual([ids[0]]);
    expect(second.pagination.nextCursor).toBeNull();
    await expect(ops.list({ status: 'LOST' })).rejects.toThrow('status');
  });
});

describe('recurring scheduled messages', () => {
  const DAY_MS = 86_400_000;

  async function seriesActor() {
    const actor = await createUser(ctx, { role: 'COORDINADOR' });
    const [channel] = await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'room-series', name: 'Series', type: 'CHANNEL', purpose: 'GENERAL' }).returning({ id: rocketchatChannels.id });
    return { actor: { sub: actor.id, role: 'COORDINADOR' as const }, channelId: channel.id };
  }

  function rows() {
    return ctx.db.select({ id: scheduledMessages.id, body: scheduledMessages.body, scheduledFor: scheduledMessages.scheduledFor, status: scheduledMessages.status, attempts: scheduledMessages.attempts, lastError: scheduledMessages.lastError }).from(scheduledMessages).orderBy(scheduledMessages.scheduledFor);
  }

  it('summarizes the missed occurrences in one SKIPPED row and schedules the next one', async () => {
    const { actor, channelId } = await seriesActor();
    const start = new Date(Date.now() - 3 * DAY_MS + 10 * 60_000);
    const { communication, worker } = services();
    await communication.schedule({ channelId, body: 'Corte diario', scheduledFor: start.toISOString(), recurrenceRule: { frequency: 'DAILY' } }, actor);

    await worker.tick();

    const series = await rows();
    expect(series.map((row) => row.status)).toEqual(['SKIPPED', 'PENDING']);
    expect(series[0].lastError).toMatch(/^3 ocurrencias omitidas \(\d{4}-\d{2}-\d{2} a \d{4}-\d{2}-\d{2}\) por retraso del worker$/);
    expect(series[1].scheduledFor.toISOString()).toBe(new Date(start.getTime() + 3 * DAY_MS).toISOString());
    expect(requests).toEqual([]);
    await expect(ctx.db.select({ id: outboxEvents.id }).from(outboxEvents)).resolves.toEqual([]);
  });

  it('leaves the series pending and keeps the batch when the app clock lags the database', async () => {
    const { actor, channelId } = await seriesActor();
    const { communication, worker } = services();
    const seriesAt = new Date(Date.now() - 10_000);
    await communication.schedule({ channelId, body: 'Serie adelantada', scheduledFor: seriesAt.toISOString(), recurrenceRule: { frequency: 'DAILY' } }, actor);
    const oneOff = await communication.schedule({ channelId, body: 'Puntual del mismo lote', scheduledFor: new Date(Date.now() - 5_000).toISOString() }, actor);

    // El SELECT usa el now() de Postgres; la app va un minuto atrasada.
    const real = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(real - 60_000);
    try {
      // Se comprueba el estado en la base, no si el tick lanza.
      await worker.tick().catch(() => undefined);
    } finally {
      vi.useRealTimers();
    }

    const afterLag = await rows();
    const series = afterLag.find((row) => row.body === 'Serie adelantada');
    expect(series).toMatchObject({ status: 'PENDING', scheduledFor: seriesAt });
    expect(afterLag.find((row) => row.id === oneOff.id)?.status).not.toBe('PENDING');

    await worker.tick();
    const caughtUp = (await rows()).filter((row) => row.body === 'Serie adelantada');
    expect(caughtUp.map((row) => row.status)).toEqual([expect.stringMatching(/^(QUEUED|SENT)$/), 'PENDING']);
  });

  it('sends the latest occurrence when the delay is inside the grace window', async () => {
    const { actor, channelId } = await seriesActor();
    const start = new Date(Date.now() - 20 * 60_000);
    const { communication, worker } = services();
    await communication.schedule({ channelId, body: 'Aviso de turno', scheduledFor: start.toISOString(), recurrenceRule: { frequency: 'DAILY' } }, actor);

    await worker.tick();

    expect(requests).toEqual([{ id: expect.stringMatching(/^agency-outbox-/), roomId: 'room-series', body: 'Aviso de turno' }]);
    const series = await rows();
    expect(series.map((row) => [row.status, row.scheduledFor.toISOString()])).toEqual([
      ['SENT', start.toISOString()],
      ['PENDING', new Date(start.getTime() + DAY_MS).toISOString()],
    ]);
  });

  it('keeps a weekly series on its selected weekday', async () => {
    const { actor, channelId } = await seriesActor();
    const start = new Date(Date.now() - 20 * 60_000);
    const tomorrow = shiftBusinessDate(businessDateInBogota(start), 1);
    const { communication, worker } = services();
    await communication.schedule({ channelId, body: 'Semanal', scheduledFor: start.toISOString(), recurrenceRule: { frequency: 'WEEKLY', weekdays: [weekdayForBusinessDate(tomorrow)] } }, actor);

    await worker.tick();

    const series = await rows();
    expect(series.map((row) => row.status)).toEqual(['SENT', 'PENDING']);
    expect(series[1].scheduledFor.toISOString()).toBe(new Date(start.getTime() + DAY_MS).toISOString());
  });

  it('keeps scheduling a series without until and stops the one whose until is today', async () => {
    const { actor, channelId } = await seriesActor();
    const start = new Date(Date.now() - 20 * 60_000);
    const { communication, worker } = services();
    await communication.schedule({ channelId, body: 'Con límite', scheduledFor: start.toISOString(), recurrenceRule: { frequency: 'DAILY', until: businessDateInBogota(start) } }, actor);
    await communication.schedule({ channelId, body: 'Sin límite', scheduledFor: start.toISOString(), recurrenceRule: { frequency: 'DAILY' } }, actor);

    await worker.tick();

    const series = await rows();
    const of = (body: string) => series.filter((row) => row.body === body).map((row) => row.status);
    expect(of('Sin límite')).toEqual(['SENT', 'PENDING']);
    expect(of('Con límite')).toEqual(['SENT']);
    expect(requests.map((request) => request.body).sort()).toEqual(['Con límite', 'Sin límite']);
  });

  it('stops the series when the pending occurrence is cancelled', async () => {
    const { actor, channelId } = await seriesActor();
    const start = new Date(Date.now() - 20 * 60_000);
    const { communication, worker } = services();
    await communication.schedule({ channelId, body: 'Serie cancelada', scheduledFor: start.toISOString(), recurrenceRule: { frequency: 'DAILY' } }, actor);

    await worker.tick();
    const [, next] = await rows();
    expect(next.status).toBe('PENDING');

    await expect(communication.cancelScheduled(next.id, actor)).resolves.toMatchObject({ status: 'CANCELLED' });
    await worker.tick();

    const series = await rows();
    expect(series.map((row) => row.status)).toEqual(['SENT', 'CANCELLED']);
    expect(requests).toHaveLength(1);
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
    await ctx.db.update(users).set({ rocketchatUserId: 'rc-user-1' }).where(eq(users.id, operator.id));
    const { bot, worker } = services();
    await bot.setKnowledge('horarios', { version: 1, question: 'Horarios', answer: 'Tu turno aparece en el panel.', keywords: ['horario', 'turno'], crewIds: [] }, admin.id);
    const [otherCrew] = await ctx.db.insert(crews).values({ name: 'Otra cuadrilla' }).returning({ id: crews.id });
    await bot.setKnowledge('horarios-privados', { version: 9, question: 'Horario privado', answer: 'Información de otra cuadrilla.', keywords: ['horario', 'turno'], crewIds: [otherCrew.id] }, admin.id);
    await ctx.db.insert(rocketchatChannels).values([
      { rcRoomId: 'bot-room', name: 'Ayuda bot', type: 'CHANNEL', purpose: 'BOT' },
      { crewId: otherCrew.id, rcRoomId: 'other-crew-room', name: 'Other crew bot', type: 'CHANNEL', purpose: 'BOT' },
    ]);

    const event = { token: process.env.ROCKETCHAT_WEBHOOK_SECRET!, user_id: 'rc-user-1', channel_id: 'bot-room', message_id: 'rc-message-1', timestamp: new Date().toISOString(), text: 'ayuda ¿Cuál es mi horario de turno?', trigger_word: 'ayuda' };
    await expect(bot.handle({ ...event, channel_id: 'other-crew-room' })).resolves.toMatchObject({ accepted: true, reason: 'ROOM_OUTSIDE_CREW_SCOPE' });
    await bot.handle(event);
    await bot.handle(event);
    await worker.tick();

    expect(requests).toEqual([{ id: expect.stringMatching(/^agency-outbox-/), roomId: 'bot-room', body: 'Tu turno aparece en el panel.' }]);
    const botAudits = await ctx.db.select({ metadata: auditLog.metadata }).from(auditLog).where(eq(auditLog.action, 'rocketchat.bot.query'));
    expect(stableBotAuditMetadata(botAudits)).toEqual([
      { article: 'horarios', outcome: 'ANSWERED', source: 'ROCKETCHAT', version: 1 },
      { outcome: 'DUPLICATE', source: 'ROCKETCHAT' },
      { outcome: 'ROOM_OUTSIDE_CREW_SCOPE', source: 'ROCKETCHAT' },
    ]);

    await bot.handle({ ...event, message_id: 'rc-message-2', text: 'ayuda desactiva mi usuario y cambia el vault' });
    await worker.tick();
    const [stillActive] = await ctx.db.select({ status: users.status }).from(users).where(eq(users.id, operator.id));
    expect(stillActive.status).toBe('ACTIVE');
    expect(requests.at(-1)?.body).toContain('no ejecuta cambios operativos');
    const allBotAudits = await ctx.db.select({ metadata: auditLog.metadata }).from(auditLog).where(eq(auditLog.action, 'rocketchat.bot.query'));
    expect(stableBotAuditMetadata(allBotAudits)).toEqual([
      { article: 'horarios', outcome: 'ANSWERED', source: 'ROCKETCHAT', version: 1 },
      { outcome: 'DUPLICATE', source: 'ROCKETCHAT' },
      { outcome: 'NO_MATCH', source: 'ROCKETCHAT' },
      { outcome: 'ROOM_OUTSIDE_CREW_SCOPE', source: 'ROCKETCHAT' },
    ]);
  });

  it('answers an unlinked Rocket.Chat user only with the generic message', async () => {
    await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'bot-room', name: 'Ayuda bot', type: 'CHANNEL', purpose: 'BOT' });
    const { bot, worker } = services();

    await bot.handle({ token: process.env.ROCKETCHAT_WEBHOOK_SECRET!, user_id: 'unlinked', channel_id: 'bot-room', message_id: 'unlinked-message', timestamp: new Date().toISOString(), text: 'ayuda turno', trigger_word: 'ayuda' });
    await worker.tick();

    expect(requests).toEqual([{ id: expect.stringMatching(/^agency-outbox-/), roomId: 'bot-room', body: 'Tu cuenta todavía no está vinculada con Agency OS. Contacta a administración' }]);
  });

  it('logs sanitized discard reasons without leaking webhook secrets or message bodies (E1-15)', async () => {
    const audit = new AuditService(ctx.database);
    const config = new ConfigService();
    const logger = new LoggerService('fatal');
    const warnSpy = vi.spyOn(logger, 'warn');
    const bot = new BotService(ctx.database, config, audit, ctx.redis, new FaqBotAnswerProvider(), logger);

    const leakedSecret = 'wrong-super-secret-webhook-token-value-12345';
    const sensitiveBody = 'ayuda mi contraseña secreta es XYZ-999';
    await expect(bot.handle({ invalid: true })).resolves.toEqual({ accepted: true, reason: 'INVALID_PAYLOAD' });
    await expect(bot.handle({
      token: leakedSecret,
      user_id: 'rc-user-1',
      channel_id: 'bot-room',
      message_id: 'discard-1',
      timestamp: new Date().toISOString(),
      text: sensitiveBody,
      trigger_word: 'ayuda',
    })).resolves.toEqual({ accepted: true, reason: 'INVALID_TOKEN' });
    await expect(bot.handle({
      token: process.env.ROCKETCHAT_WEBHOOK_SECRET!,
      user_id: 'rc-user-1',
      channel_id: 'unregistered-room',
      message_id: 'discard-2',
      timestamp: new Date().toISOString(),
      text: sensitiveBody,
      trigger_word: 'ayuda',
    })).resolves.toEqual({ accepted: true, reason: 'ROOM_NOT_REGISTERED' });

    expect(warnSpy.mock.calls).toEqual([
      ['Rocket.Chat bot webhook discarded', { source: 'ROCKETCHAT', reason: 'INVALID_PAYLOAD' }],
      ['Rocket.Chat bot webhook discarded', { source: 'ROCKETCHAT', reason: 'INVALID_TOKEN' }],
      ['Rocket.Chat bot webhook discarded', { source: 'ROCKETCHAT', reason: 'ROOM_NOT_REGISTERED' }],
    ]);
    const serialized = JSON.stringify(warnSpy.mock.calls);
    expect(serialized).not.toContain(leakedSecret);
    expect(serialized).not.toContain(process.env.ROCKETCHAT_WEBHOOK_SECRET!);
    expect(serialized).not.toContain(sensitiveBody);
  });

  it('limits each Rocket.Chat user to ten queries per minute in Redis', async () => {
    const operator = await createUser(ctx);
    await ctx.db.update(users).set({ rocketchatUserId: 'rate-limited-user' }).where(eq(users.id, operator.id));
    await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'bot-room', name: 'Ayuda bot', type: 'CHANNEL', purpose: 'BOT' });
    const { bot } = services();

    for (let index = 0; index < 11; index += 1) {
      await expect(bot.handle({ token: process.env.ROCKETCHAT_WEBHOOK_SECRET!, user_id: 'rate-limited-user', channel_id: 'bot-room', message_id: `rate-message-${index}`, timestamp: new Date().toISOString(), text: 'ayuda turno', trigger_word: 'ayuda' })).resolves.toMatchObject({ accepted: true });
    }

    const events = await ctx.db.select({ id: outboxEvents.id }).from(outboxEvents);
    expect(events).toHaveLength(10);
  });
});

describe('Rocket.Chat channel lifecycle and drift scan (E1-13)', () => {
  it('updates, unlinks, and deactivates channels with crew scoping and audit trail', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const [ownedCrew] = await ctx.db.insert(crews).values({ name: 'Crew A', coordinatorId: coordinator.id }).returning({ id: crews.id });
    const [foreignCrew] = await ctx.db.insert(crews).values({ name: 'Crew B' }).returning({ id: crews.id });
    const [ownedChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: ownedCrew.id, rcRoomId: 'grp-crew-a', name: 'Crew A Private', type: 'GROUP', purpose: 'CREW' }).returning();
    const [foreignChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: foreignCrew.id, rcRoomId: 'grp-crew-b', name: 'Crew B Private', type: 'GROUP', purpose: 'CREW' }).returning();
    const { communication } = services();
    const coordActor = { sub: coordinator.id, role: 'COORDINADOR' as const };
    const adminActor = { sub: admin.id, role: 'ADMIN' as const };

    await expect(communication.updateChannel(ownedChannel.id, {}, adminActor)).rejects.toThrow(BadRequestException);
    await expect(communication.updateChannel(foreignChannel.id, { name: 'Hijack' }, coordActor)).rejects.toThrow(ForbiddenException);
    await expect(communication.updateChannel(ownedChannel.id, { crewId: null }, coordActor)).rejects.toThrow(ForbiddenException);
    await expect(communication.updateChannel(ownedChannel.id, { crewId: foreignCrew.id }, coordActor)).rejects.toThrow(ForbiddenException);

    const renamed = await communication.updateChannel(ownedChannel.id, { name: 'Crew A Ops' }, coordActor);
    expect(renamed.name).toBe('Crew A Ops');
    expect(renamed.isActive).toBe(true);

    const archived = await communication.updateChannel(ownedChannel.id, { crewId: null, isActive: false }, adminActor);
    expect(archived.crewId).toBeNull();
    expect(archived.isActive).toBe(false);
    await expect(communication.channels(adminActor)).resolves.toEqual([expect.objectContaining({ id: foreignChannel.id })]);

    const audits = await ctx.db
      .select({ actorUserId: auditLog.actorUserId, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.action, 'rocketchat.channel.updated'));
    expect(audits).toHaveLength(2);
    expect(audits).toEqual(expect.arrayContaining([
      { actorUserId: coordinator.id, metadata: expect.objectContaining({ crewId: ownedCrew.id, status: 'ACTIVE' }) },
      { actorUserId: admin.id, metadata: expect.objectContaining({ crewId: null, status: 'INACTIVE' }) },
    ]));
  });

  it('keeps coordinators on CREW-purpose channels so they cannot capture ALERTS or BOT routing', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    const [ownedCrew] = await ctx.db.insert(crews).values({ name: 'Crew A', coordinatorId: coordinator.id }).returning({ id: crews.id });
    const [crewChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: ownedCrew.id, rcRoomId: 'grp-crew-a', name: 'Crew A', type: 'GROUP', purpose: 'CREW' }).returning();
    const [alertsChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: ownedCrew.id, rcRoomId: 'grp-alerts', name: 'Alerts', type: 'GROUP', purpose: 'ALERTS' }).returning();
    const { communication } = services();
    const coordActor = { sub: coordinator.id, role: 'COORDINADOR' as const };
    const adminActor = { sub: admin.id, role: 'ADMIN' as const };

    await expect(communication.updateChannel(crewChannel.id, { purpose: 'ALERTS' }, coordActor)).rejects.toThrow(ForbiddenException);
    await expect(communication.updateChannel(crewChannel.id, { purpose: 'BOT' }, coordActor)).rejects.toThrow(ForbiddenException);
    await expect(communication.updateChannel(alertsChannel.id, { name: 'Mine now' }, coordActor)).rejects.toThrow(ForbiddenException);
    await expect(communication.createChannel({ crewId: ownedCrew.id, rcRoomId: 'grp-new-alerts', name: 'New alerts', type: 'GROUP', purpose: 'ALERTS' }, coordActor)).rejects.toThrow(ForbiddenException);
    const stored = await ctx.db.select({ id: rocketchatChannels.id, name: rocketchatChannels.name, purpose: rocketchatChannels.purpose }).from(rocketchatChannels).orderBy(asc(rocketchatChannels.rcRoomId));
    expect(stored).toEqual([
      { id: alertsChannel.id, name: 'Alerts', purpose: 'ALERTS' },
      { id: crewChannel.id, name: 'Crew A', purpose: 'CREW' },
    ]);

    await expect(communication.updateChannel(crewChannel.id, { purpose: 'CREW', name: 'Crew A Ops' }, coordActor)).resolves.toMatchObject({ purpose: 'CREW', name: 'Crew A Ops' });
    await expect(communication.createChannel({ crewId: ownedCrew.id, rcRoomId: 'grp-crew-a2', name: 'Crew A 2', type: 'GROUP', purpose: 'CREW' }, coordActor)).resolves.toMatchObject({ purpose: 'CREW' });
    await expect(communication.updateChannel(crewChannel.id, { purpose: 'ALERTS' }, adminActor)).resolves.toMatchObject({ purpose: 'ALERTS' });
  });

  it('detects membership drift read-only via groups.members without mutating Rocket.Chat', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const coordinator = await createUser(ctx, { role: 'COORDINADOR' });
    await ctx.db.update(users).set({ fullName: 'Coord A', rocketchatUserId: 'rc-coord-a' }).where(eq(users.id, coordinator.id));

    const synced = await createUser(ctx);
    const missing = await createUser(ctx);
    const unlinked = await createUser(ctx);
    const departed = await createUser(ctx);
    await ctx.db.update(users).set({ fullName: 'Ana Synced', rocketchatUserId: 'rc-synced' }).where(eq(users.id, synced.id));
    await ctx.db.update(users).set({ fullName: 'Beto Missing', rocketchatUserId: 'rc-missing' }).where(eq(users.id, missing.id));
    await ctx.db.update(users).set({ fullName: 'Camilo Unlinked' }).where(eq(users.id, unlinked.id));
    await ctx.db.update(users).set({ fullName: 'Diana Departed', rocketchatUserId: 'rc-departed' }).where(eq(users.id, departed.id));

    const [ownedCrew] = await ctx.db.insert(crews).values({ name: 'Crew Drift', coordinatorId: coordinator.id }).returning({ id: crews.id });
    const [foreignCrew] = await ctx.db.insert(crews).values({ name: 'Foreign Drift' }).returning({ id: crews.id });
    const now = Date.now();
    const pastRange = `[${new Date(now - 172_800_000).toISOString()},${new Date(now - 86_400_000).toISOString()})`;
    const activeRange = `[${new Date(now - 3_600_000).toISOString()},)`;
    await ctx.db.insert(crewMembers).values([
      { crewId: ownedCrew.id, userId: synced.id, validRange: activeRange },
      { crewId: ownedCrew.id, userId: missing.id, validRange: activeRange },
      { crewId: ownedCrew.id, userId: unlinked.id, validRange: activeRange },
      { crewId: ownedCrew.id, userId: departed.id, validRange: pastRange },
    ]);

    const [groupChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: ownedCrew.id, rcRoomId: 'grp-drift-1', name: 'Crew Drift', type: 'GROUP', purpose: 'CREW' }).returning();
    const [foreignChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: foreignCrew.id, rcRoomId: 'grp-foreign-1', name: 'Foreign', type: 'GROUP', purpose: 'CREW' }).returning();
    const [unlinkedChannel] = await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'chan-general', name: 'General', type: 'CHANNEL', purpose: 'GENERAL' }).returning();
    const [dmChannel] = await ctx.db.insert(rocketchatChannels).values({ crewId: ownedCrew.id, rcRoomId: 'dm-1', name: 'DM', type: 'DM', purpose: 'CREW' }).returning();

    roomMembersByRoom['grp-drift-1'] = [
      { _id: 'bot-user', username: 'agency.bot', name: 'Agency Bot' },
      { _id: 'rc-coord-a', username: 'coord.a', name: 'Coord A' },
      { _id: 'rc-synced', username: 'ana', name: 'Ana Synced' },
      { _id: 'rc-departed', username: 'diana', name: 'Diana Departed' },
    ];

    const { communication } = services();
    const coordActor = { sub: coordinator.id, role: 'COORDINADOR' as const };
    const adminActor = { sub: admin.id, role: 'ADMIN' as const };

    await expect(communication.channelDrift(foreignChannel.id, coordActor)).rejects.toThrow(ForbiddenException);
    await expect(communication.channelDrift(unlinkedChannel.id, adminActor)).rejects.toThrow(BadRequestException);
    await expect(communication.channelDrift(dmChannel.id, adminActor)).rejects.toThrow(BadRequestException);

    const report = await communication.channelDrift(groupChannel.id, coordActor);
    expect(report).toMatchObject({
      channelId: groupChannel.id,
      crewId: ownedCrew.id,
      rcRoomId: 'grp-drift-1',
      roomType: 'GROUP',
      inSyncCount: 1,
      driftCount: 3,
      missingInRocketChat: [{ userId: missing.id, fullName: 'Beto Missing', rocketchatUserId: 'rc-missing' }],
      unlinkedCrewMembers: [{ userId: unlinked.id, fullName: 'Camilo Unlinked' }],
      unexpectedInRocketChat: [{ rocketchatUserId: 'rc-departed', username: 'diana', name: 'Diana Departed' }],
    });
    expect(memberListRequests).toEqual([{ method: 'GET', url: '/api/v1/groups.members?roomId=grp-drift-1&count=100&offset=0' }]);
    expect(requests).toEqual([]);

    const driftAudits = await ctx.db
      .select({ actorUserId: auditLog.actorUserId, metadata: auditLog.metadata })
      .from(auditLog)
      .where(eq(auditLog.action, 'rocketchat.channel.drift_scanned'));
    expect(driftAudits).toEqual([
      { actorUserId: coordinator.id, metadata: expect.objectContaining({ crewId: ownedCrew.id, count: 3 }) },
    ]);
  });
});
