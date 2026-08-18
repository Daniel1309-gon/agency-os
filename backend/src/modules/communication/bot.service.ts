import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, like, sql } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { appSettings, crewMembers, crews, outboxEvents, rocketchatChannels, users } from '../../database/schema/index.js';
import { botKnowledgeSchema, type BotKnowledgeInput } from './communication.schemas.js';
import { BOT_ANSWER_PROVIDER, type BotAnswerProvider, type BotKnowledgeArticle } from './bot-answer.provider.js';
import { normalizeRocketChatWebhook, stripBotTrigger, type BotWebhookInput } from './bot-webhook.js';

const KNOWLEDGE_PREFIX = 'rocketchat.bot.knowledge.';
const KNOWLEDGE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const BOT_RATE_LIMIT = 10;
const BOT_RATE_WINDOW_SECONDS = 60;
const UNLINKED_MESSAGE = 'Tu cuenta todavía no está vinculada con Agency OS. Contacta a administración';
const UNKNOWN_MESSAGE = 'No encontré esa información en la base de ayuda. Consulta a tu coordinador. Este bot es informativo y no ejecuta cambios operativos.';
type Knowledge = z.infer<typeof botKnowledgeSchema>;

@Injectable()
export class BotService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    @Inject(BOT_ANSWER_PROVIDER) private readonly answers: BotAnswerProvider,
  ) {}

  /**
   * Processes a native Rocket.Chat outgoing integration payload. Application
   * outcomes are acknowledged so Rocket.Chat does not replay them; transport
   * and database failures still throw and remain retryable.
   */
  async handle(payload: unknown): Promise<{ accepted: true; reason?: string }> {
    const startedAt = Date.now();
    const input = normalizeRocketChatWebhook(payload);
    if (!input) return { accepted: true, reason: 'INVALID_PAYLOAD' };
    if (!this.secretMatches(input.token)) return { accepted: true, reason: 'INVALID_TOKEN' };
    if (input.userId === this.config.get('ROCKETCHAT_USER_ID')) return { accepted: true, reason: 'OWN_MESSAGE' };
    if (input.triggerWord.toLocaleLowerCase() !== this.config.get('ROCKETCHAT_BOT_TRIGGER').toLocaleLowerCase()) return { accepted: true, reason: 'TRIGGER_NOT_CONFIGURED' };

    const question = stripBotTrigger(input.text, this.config.get('ROCKETCHAT_BOT_TRIGGER'));
    if (question === undefined) return { accepted: true, reason: 'PREFIX_NOT_MATCHED' };

    const room = await this.findBotRoom(input.roomId);
    if (!room) return { accepted: true, reason: 'ROOM_NOT_REGISTERED' };

    const rateLimited = await this.isRateLimited(input.userId);
    if (rateLimited) {
      await this.recordOutcome(undefined, 'RATE_LIMITED', undefined, undefined, startedAt);
      return { accepted: true, reason: 'RATE_LIMITED' };
    }

    const [user] = await this.db.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.rocketchatUserId, input.userId), eq(users.status, 'ACTIVE')))
      .limit(1);

    if (!user) {
      const inserted = await this.enqueueResponse(input, UNLINKED_MESSAGE);
      await this.recordOutcome(undefined, inserted ? 'UNLINKED_USER' : 'DUPLICATE', undefined, undefined, startedAt);
      return { accepted: true };
    }

    const allowedCrewIds = await this.currentCrewIds(user.id);
    if (room.crewId && !allowedCrewIds.has(room.crewId)) {
      await this.recordOutcome(user.id, 'ROOM_OUTSIDE_CREW_SCOPE', undefined, undefined, startedAt);
      return { accepted: true, reason: 'ROOM_OUTSIDE_CREW_SCOPE' };
    }

    const articles = await this.approvedArticles(allowedCrewIds);
    const answer = this.answers.answer(question, articles);
    const inserted = await this.enqueueResponse(input, answer?.answer ?? UNKNOWN_MESSAGE);
    await this.recordOutcome(user.id, inserted ? (answer ? 'ANSWERED' : 'NO_MATCH') : 'DUPLICATE', inserted ? answer?.slug : undefined, inserted ? answer?.version : undefined, startedAt);
    return { accepted: true };
  }

  async setKnowledge(slug: string, input: BotKnowledgeInput, actorId: string): Promise<{ slug: string; version: number }> {
    if (!KNOWLEDGE_SLUG.test(slug)) throw new BadRequestException('Knowledge slug must use lowercase letters, numbers and hyphens');
    const parsed = botKnowledgeSchema.parse(input);
    const key = `${KNOWLEDGE_PREFIX}${slug}`;
    const current = await this.db.db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
    const currentVersion = botKnowledgeSchema.safeParse(current?.value);
    if (currentVersion.success && parsed.version <= currentVersion.data.version) {
      throw new ConflictException('Knowledge version must increase');
    }
    await this.db.db
      .insert(appSettings)
      .values({ key, value: parsed, description: parsed.question, updatedBy: actorId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed, description: parsed.question, updatedBy: actorId, updatedAt: new Date() } });
    await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'rocketchat.bot.knowledge.updated', entityType: 'bot_knowledge', result: 'SUCCESS', metadata: { version: parsed.version, article: slug } });
    return { slug, version: parsed.version };
  }

  async listKnowledge(): Promise<Array<{ slug: string; value: Knowledge }>> {
    const rows = await this.db.db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(like(appSettings.key, `${KNOWLEDGE_PREFIX}%`));
    return rows.flatMap((row) => {
      const parsed = botKnowledgeSchema.safeParse(row.value);
      return parsed.success ? [{ slug: row.key.slice(KNOWLEDGE_PREFIX.length), value: parsed.data }] : [];
    });
  }

  private async findBotRoom(roomId: string): Promise<{ crewId: string | null } | undefined> {
    const [room] = await this.db.db
      .select({ crewId: rocketchatChannels.crewId })
      .from(rocketchatChannels)
      .where(and(eq(rocketchatChannels.rcRoomId, roomId), eq(rocketchatChannels.purpose, 'BOT'), eq(rocketchatChannels.isActive, true)))
      .limit(1);
    return room;
  }

  private async currentCrewIds(userId: string): Promise<Set<string>> {
    const rows = await this.db.db
      .select({ crewId: crewMembers.crewId })
      .from(crewMembers)
      .innerJoin(crews, eq(crews.id, crewMembers.crewId))
      .where(and(eq(crewMembers.userId, userId), eq(crews.isActive, true), sql`${crewMembers.validRange} @> now()`));
    return new Set(rows.map((row) => row.crewId));
  }

  private async approvedArticles(allowedCrewIds: Set<string>): Promise<BotKnowledgeArticle[]> {
    const rows = await this.db.db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(like(appSettings.key, `${KNOWLEDGE_PREFIX}%`));
    return rows.flatMap((row) => {
      const parsed = botKnowledgeSchema.safeParse(row.value);
      if (!parsed.success) return [];
      const article: BotKnowledgeArticle = { ...parsed.data, slug: row.key.slice(KNOWLEDGE_PREFIX.length) };
      return article.crewIds.length === 0 || article.crewIds.some((crewId) => allowedCrewIds.has(crewId)) ? [article] : [];
    });
  }

  private async enqueueResponse(input: BotWebhookInput, body: string): Promise<boolean> {
    const [inserted] = await this.db.db
      .insert(outboxEvents)
      .values({
        eventType: 'rocketchat.message.send',
        aggregateType: 'bot_response',
        payload: { roomId: input.roomId, body, sourceMessageId: input.messageId },
      })
      .onConflictDoNothing()
      .returning({ id: outboxEvents.id });
    return Boolean(inserted);
  }

  private async isRateLimited(rocketChatUserId: string): Promise<boolean> {
    const userKey = createHash('sha256').update(rocketChatUserId).digest('hex');
    const count = await this.redis.incrWithExpiry(`rocketchat:bot:queries:${userKey}`, BOT_RATE_WINDOW_SECONDS);
    return count > BOT_RATE_LIMIT;
  }

  private async recordOutcome(userId: string | undefined, outcome: string, article: string | undefined, version: number | undefined, startedAt: number): Promise<void> {
    await this.audit.record({
      actorType: userId ? 'USER' : 'ANONYMOUS',
      actorUserId: userId,
      action: 'rocketchat.bot.query',
      entityType: userId ? 'user' : undefined,
      entityId: userId,
      result: outcome === 'ANSWERED' || outcome === 'UNLINKED_USER' ? 'SUCCESS' : 'IGNORED',
      metadata: { source: 'ROCKETCHAT', outcome, ...(article ? { article } : {}), ...(version ? { version } : {}), latencyMs: Date.now() - startedAt },
    });
  }

  private secretMatches(provided: string): boolean {
    const expected = this.config.get('ROCKETCHAT_WEBHOOK_SECRET');
    if (!expected) return false;
    const left = createHash('sha256').update(expected).digest();
    const right = createHash('sha256').update(provided).digest();
    return timingSafeEqual(left, right);
  }
}
