import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, like, sql } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import { ConfigService } from '../../config/config.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { appSettings, crewMembers, outboxEvents, rocketchatChannels, users } from '../../database/schema/index.js';
import { botKnowledgeSchema, type BotKnowledgeInput, type BotWebhookInput } from './communication.schemas.js';

const KNOWLEDGE_PREFIX = 'rocketchat.bot.knowledge.';
const KNOWLEDGE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
type Knowledge = z.infer<typeof botKnowledgeSchema>;

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

@Injectable()
export class BotService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async handle(input: BotWebhookInput, providedSecret: string | undefined): Promise<{ accepted: true }> {
    if (!this.secretMatches(providedSecret)) throw new UnauthorizedException('Invalid Rocket.Chat webhook secret');
    const [user] = await this.db.db.select({ id: users.id, directRoomId: users.rocketchatDirectRoomId }).from(users).where(and(eq(users.rocketchatUserId, input.userId), eq(users.status, 'ACTIVE'))).limit(1);
    if (!user) throw new UnauthorizedException('Rocket.Chat user is not mapped to an active Agency OS user');
    const memberships = await this.db.db.select({ crewId: crewMembers.crewId }).from(crewMembers).where(and(eq(crewMembers.userId, user.id), sql`${crewMembers.validRange} @> now()`));
    const allowedCrewIds = new Set(memberships.map((row) => row.crewId));
    if (input.roomId !== user.directRoomId) {
      const [room] = await this.db.db.select({ crewId: rocketchatChannels.crewId }).from(rocketchatChannels).where(and(eq(rocketchatChannels.rcRoomId, input.roomId), eq(rocketchatChannels.isActive, true))).limit(1);
      if (!room || (room.crewId && !allowedCrewIds.has(room.crewId))) throw new UnauthorizedException('Rocket.Chat room is outside the user crew scope');
    }
    const articles = await this.db.db.select({ value: appSettings.value }).from(appSettings).where(like(appSettings.key, `${KNOWLEDGE_PREFIX}%`));
    const knowledge = articles.map((row) => botKnowledgeSchema.safeParse(row.value)).filter((result): result is z.SafeParseSuccess<Knowledge> => result.success).map((result) => result.data).filter((article) => article.crewIds.length === 0 || article.crewIds.some((id) => allowedCrewIds.has(id)));
    const text = normalize(input.text);
    const ranked = knowledge.map((article) => ({ article, score: article.keywords.filter((keyword) => text.includes(normalize(keyword))).length })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.article.version - a.article.version);
    const body = ranked[0]?.article.answer ?? 'No encontré esa información en la base de ayuda. Consulta a tu coordinador. Este bot es informativo y no ejecuta cambios operativos.';
    await this.db.db.insert(outboxEvents).values({ eventType: 'rocketchat.message.send', aggregateType: 'bot_response', payload: { roomId: input.roomId, body, sourceMessageId: input.messageId } }).onConflictDoNothing();
    await this.audit.record({ actorType: 'USER', actorUserId: user.id, action: 'rocketchat.bot.answered', entityType: 'user', entityId: user.id, result: 'SUCCESS', metadata: { source: 'ROCKETCHAT', version: ranked[0]?.article.version } });
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
    await this.db.db.insert(appSettings).values({ key, value: parsed, description: parsed.question, updatedBy: actorId }).onConflictDoUpdate({ target: appSettings.key, set: { value: parsed, description: parsed.question, updatedBy: actorId, updatedAt: new Date() } });
    await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'rocketchat.bot.knowledge.updated', entityType: 'bot_knowledge', result: 'SUCCESS', metadata: { version: parsed.version } });
    return { slug, version: parsed.version };
  }

  async listKnowledge(): Promise<Array<{ slug: string; value: Knowledge }>> {
    const rows = await this.db.db.select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(like(appSettings.key, `${KNOWLEDGE_PREFIX}%`));
    return rows.flatMap((row) => {
      const parsed = botKnowledgeSchema.safeParse(row.value);
      return parsed.success ? [{ slug: row.key.slice(KNOWLEDGE_PREFIX.length), value: parsed.data }] : [];
    });
  }

  private secretMatches(provided: string | undefined): boolean {
    const expected = this.config.get('ROCKETCHAT_WEBHOOK_SECRET');
    if (!expected || !provided) return false;
    const left = createHash('sha256').update(expected).digest();
    const right = createHash('sha256').update(provided).digest();
    return timingSafeEqual(left, right);
  }
}
