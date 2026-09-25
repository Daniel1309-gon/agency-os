import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { icebreakerEffectiveness, icebreakerEvaluations, icebreakerReviews, icebreakerRules, icebreakerViolations, icebreakers } from '../../database/schema/index.js';
import type { IcebreakerCreateInput, IcebreakerUpdateInput, ReviewInput, RuleInput, RuleUpdateInput } from './icebreakers.schemas.js';
import { AiEngineClient } from './ai-engine.client.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';

type IcebreakerActor = Pick<AccessTokenClaims, 'sub' | 'role'>;

const isGlobalReviewer = (actor: IcebreakerActor): boolean => actor.role === 'ADMIN' || actor.role === 'DIRECTOR_OPERATIVO';

@Injectable()
export class IcebreakersService {
  constructor(private readonly db: DatabaseService, private readonly aiEngine: AiEngineClient) {}

  async list(actor: IcebreakerActor) { return this.db.db.select({ id: icebreakers.id, profileId: icebreakers.profileId, text: icebreakers.text, status: icebreakers.status, version: icebreakers.version, publishedAt: icebreakers.publishedAt, createdAt: icebreakers.createdAt, updatedAt: icebreakers.updatedAt }).from(icebreakers).where(eq(icebreakers.operatorId, actor.sub)).orderBy(asc(icebreakers.createdAt)); }

  async create(input: IcebreakerCreateInput, actor: IcebreakerActor) { const [row] = await this.db.db.insert(icebreakers).values({ ...input, operatorId: actor.sub }).returning({ id: icebreakers.id, status: icebreakers.status, version: icebreakers.version }); return row; }

  async update(id: string, input: IcebreakerUpdateInput, actor: IcebreakerActor) {
    const { version, ...changes } = input;
    const [row] = await this.db.db.update(icebreakers).set({ ...changes, version: version + 1, updatedAt: new Date() }).where(and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub), eq(icebreakers.version, version), sql`${icebreakers.status} IN ('DRAFT', 'BLOCKED')`)).returning({ id: icebreakers.id, version: icebreakers.version, status: icebreakers.status });
    if (!row) throw new ConflictException('Icebreaker is not editable or has changed');
    return row;
  }

  async evaluate(id: string, actor: IcebreakerActor) {
    const item = await this.db.db.query.icebreakers.findFirst({ where: and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub)) });
    if (!item) throw new NotFoundException('Icebreaker not found');
    const rules = await this.db.db.query.icebreakerRules.findMany({ where: eq(icebreakerRules.isActive, true) });
    try {
      const remote = await this.aiEngine.evaluate(item.text, rules.map((rule) => ({ code: rule.code, severity: rule.severity })));
      if (remote) {
        await this.db.db.transaction(async (tx) => {
          await tx.insert(icebreakerEvaluations).values({ icebreakerId: id, evaluator: 'AI_ENGINE', status: 'SUCCESS', result: remote.result, score: remote.score.toFixed(4), model: remote.model, tokenCostUsd: remote.tokenCostUsd?.toFixed(6) });
          if (remote.status === 'BLOCKED') await tx.update(icebreakers).set({ status: 'BLOCKED', version: item.version + 1, updatedAt: new Date() }).where(eq(icebreakers.id, id));
          else await tx.update(icebreakers).set({ status: 'APPROVED', version: item.version + 1, updatedAt: new Date() }).where(eq(icebreakers.id, id));
        });
        return { id, status: remote.status, blocking: remote.status === 'BLOCKED', score: remote.score, source: 'AI_ENGINE' };
      }
    } catch (error) {
      await this.db.db.insert(icebreakerEvaluations).values({ icebreakerId: id, evaluator: 'AI_ENGINE', status: 'FAILED', result: { error: error instanceof Error ? error.message : 'Invalid AI response' } });
      throw new ConflictException('AI evaluation failed; the icebreaker was not published');
    }
    const matches: Array<{ rule: typeof rules[number]; matched: boolean }> = [];
    for (const rule of rules) {
      let matched = false;
      if (rule.kind === 'REGEX' && rule.pattern) {
        try { matched = new RegExp(rule.pattern, 'iu').test(item.text); } catch { matched = true; }
      } else if (rule.kind === 'KEYWORD' && rule.pattern) matched = item.text.toLocaleLowerCase().includes(rule.pattern.toLocaleLowerCase());
      matches.push({ rule, matched });
    }
    const violations = matches.filter((match) => match.matched);
    const blocking = violations.some((match) => match.rule.severity === 'BLOCKING');
    const status = blocking ? 'BLOCKED' : 'APPROVED';
    await this.db.db.transaction(async (tx) => {
      const [evaluation] = await tx.insert(icebreakerEvaluations).values({ icebreakerId: id, evaluator: 'LOCAL_RULES', status: 'SUCCESS', result: { matchedRules: violations.map((v) => v.rule.code), blocking }, score: blocking ? '0' : '1' }).returning({ id: icebreakerEvaluations.id });
      if (violations.length) await tx.insert(icebreakerViolations).values(violations.map(({ rule }) => ({ icebreakerId: id, ruleId: rule.id, severity: rule.severity, status: 'OPEN' })));
      await tx.update(icebreakers).set({ status, version: item.version + 1, updatedAt: new Date() }).where(eq(icebreakers.id, id));
      return evaluation;
    });
    return { id, status, blocking, matchedRules: violations.map((v) => v.rule.code) };
  }

  async publish(id: string, actor: IcebreakerActor) {
    const [row] = await this.db.db.update(icebreakers).set({ status: 'PUBLISHED', publishedAt: new Date(), updatedAt: new Date(), version: 1 }).where(and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub), eq(icebreakers.status, 'APPROVED'))).returning({ id: icebreakers.id, status: icebreakers.status, publishedAt: icebreakers.publishedAt });
    if (!row) throw new ConflictException('Icebreaker requires an approved evaluation');
    return row;
  }

  async createRule(input: RuleInput, actorId: string) { const [row] = await this.db.db.insert(icebreakerRules).values({ ...input, createdBy: actorId }).returning({ id: icebreakerRules.id, code: icebreakerRules.code, severity: icebreakerRules.severity }); return row; }

  async listRules() { return this.db.db.select({ id: icebreakerRules.id, code: icebreakerRules.code, name: icebreakerRules.name, kind: icebreakerRules.kind, pattern: icebreakerRules.pattern, severity: icebreakerRules.severity, isActive: icebreakerRules.isActive, version: icebreakerRules.version }).from(icebreakerRules).orderBy(asc(icebreakerRules.code)); }
  async updateRule(id: string, input: RuleUpdateInput) { const { version, ...changes } = input; const [row] = await this.db.db.update(icebreakerRules).set({ ...changes, version: version + 1 }).where(and(eq(icebreakerRules.id, id), eq(icebreakerRules.version, version))).returning({ id: icebreakerRules.id, version: icebreakerRules.version, isActive: icebreakerRules.isActive }); if (!row) throw new ConflictException('Rule was modified or not found'); return row; }
  async evaluations(id: string, actor: IcebreakerActor) { const item = await this.db.db.select({ id: icebreakers.id }).from(icebreakers).where(and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub))).limit(1); if (!item.length) throw new NotFoundException('Icebreaker not found'); return this.db.db.select().from(icebreakerEvaluations).where(eq(icebreakerEvaluations.icebreakerId, id)).orderBy(asc(icebreakerEvaluations.createdAt)); }
  async violations(filters: { from?: string; to?: string; operatorId?: string }, actor: IcebreakerActor) { return this.db.db.select({ id: icebreakerViolations.id, icebreakerId: icebreakerViolations.icebreakerId, ruleId: icebreakerViolations.ruleId, severity: icebreakerViolations.severity, status: icebreakerViolations.status, reviewedBy: icebreakerViolations.reviewedBy, reviewedAt: icebreakerViolations.reviewedAt, createdAt: icebreakerViolations.createdAt }).from(icebreakerViolations).innerJoin(icebreakers, eq(icebreakers.id, icebreakerViolations.icebreakerId)).where(and(filters.operatorId ? eq(icebreakers.operatorId, filters.operatorId) : undefined, this.reviewerScope(actor), filters.from ? sql`${icebreakerViolations.createdAt} >= ${new Date(filters.from)}` : undefined, filters.to ? sql`${icebreakerViolations.createdAt} < ${new Date(filters.to)}` : undefined)).orderBy(asc(icebreakerViolations.createdAt)); }
  async effectiveness(id: string, actor: IcebreakerActor) { const item = await this.db.db.select({ id: icebreakers.id }).from(icebreakers).where(and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub))).limit(1); if (!item.length) throw new NotFoundException('Icebreaker not found'); return this.db.db.select().from(icebreakerEffectiveness).where(eq(icebreakerEffectiveness.operatorId, actor.sub)).orderBy(asc(icebreakerEffectiveness.businessDate)); }

  async review(id: string, input: ReviewInput, actor: IcebreakerActor) { const item = await this.db.db.query.icebreakers.findFirst({ where: and(eq(icebreakers.id, id), this.reviewerScope(actor)) }); if (!item) throw new NotFoundException('Icebreaker not found'); const [row] = await this.db.db.insert(icebreakerReviews).values({ icebreakerId: id, reviewerId: actor.sub, verdict: input.verdict, reason: input.reason }).returning({ id: icebreakerReviews.id, verdict: icebreakerReviews.verdict }); if (input.verdict === 'OVERRIDDEN_ALLOW') await this.db.db.update(icebreakers).set({ status: 'APPROVED', updatedAt: new Date(), version: item.version + 1 }).where(eq(icebreakers.id, id)); return row; }

  private reviewerScope(actor: IcebreakerActor) {
    if (isGlobalReviewer(actor)) return sql`true`;
    if (actor.role === 'COORDINADOR') return sql`exists (
      select 1 from crew_members member
      inner join crews crew on crew.id = member.crew_id
      where member.user_id = ${icebreakers.operatorId}
        and member.valid_range @> now()
        and crew.coordinator_id = ${actor.sub}
        and crew.is_active = true
    )`;
    return eq(icebreakers.operatorId, actor.sub);
  }
}
