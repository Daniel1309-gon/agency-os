import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { icebreakerEffectiveness, icebreakerEvaluations, icebreakerReviews, icebreakerRules, icebreakerViolations, icebreakers, profileAssignments, ttProfiles, users } from '../../database/schema/index.js';
import { rulePatternIssue, type IcebreakerCreateInput, type IcebreakerUpdateInput, type ReviewInput, type RuleInput, type RuleKind, type RuleUpdateInput, type ViolationsQueryInput } from './icebreakers.schemas.js';
import { AiEngineClient, type AiEvaluation } from './ai-engine.client.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';

type IcebreakerActor = Pick<AccessTokenClaims, 'sub' | 'role'>;

const isGlobalReviewer = (actor: IcebreakerActor): boolean => actor.role === 'ADMIN' || actor.role === 'DIRECTOR_OPERATIVO';

const DEFAULT_VIOLATIONS_LIMIT = 100;

function bogotaDayStartUtc(date: string): Date {
  return new Date(`${date}T00:00:00-05:00`);
}

function bogotaNextDayStartUtc(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return bogotaDayStartUtc(next);
}

/** A rule whose regex cannot compile counts as broken: a broken guard must not pass text. */
function matchesRule(rule: { kind: string; pattern: string | null }, text: string): boolean {
  if (!rule.pattern) return false;
  if (rule.kind === 'REGEX') {
    try { return new RegExp(rule.pattern, 'iu').test(text); } catch { return true; }
  }
  return rule.kind === 'KEYWORD' && text.toLocaleLowerCase().includes(rule.pattern.toLocaleLowerCase());
}

@Injectable()
export class IcebreakersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly aiEngine: AiEngineClient,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async list(actor: IcebreakerActor) { return this.db.db.select({ id: icebreakers.id, profileId: icebreakers.profileId, text: icebreakers.text, status: icebreakers.status, version: icebreakers.version, publishedAt: icebreakers.publishedAt, createdAt: icebreakers.createdAt, updatedAt: icebreakers.updatedAt }).from(icebreakers).where(eq(icebreakers.operatorId, actor.sub)).orderBy(asc(icebreakers.createdAt)); }

  async create(input: IcebreakerCreateInput, actor: IcebreakerActor) { await this.assertAssignedProfile(input.profileId, actor); const [row] = await this.db.db.insert(icebreakers).values({ ...input, operatorId: actor.sub }).returning({ id: icebreakers.id, status: icebreakers.status, version: icebreakers.version }); return row; }

  async update(id: string, input: IcebreakerUpdateInput, actor: IcebreakerActor) {
    const { version, ...changes } = input;
    await this.assertAssignedProfile(changes.profileId, actor);
    const [row] = await this.db.db.update(icebreakers).set({ ...changes, version: version + 1, updatedAt: new Date() }).where(and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub), eq(icebreakers.version, version), sql`${icebreakers.status} IN ('DRAFT', 'BLOCKED')`)).returning({ id: icebreakers.id, version: icebreakers.version, status: icebreakers.status });
    if (!row) throw new ConflictException('Icebreaker is not editable or has changed');
    return row;
  }

  async evaluate(id: string, actor: IcebreakerActor) {
    const item = await this.db.db.query.icebreakers.findFirst({ where: and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub)) });
    if (!item) throw new NotFoundException('Icebreaker not found');
    // FR-24: drafts, blocked and approved texts can be re-evaluated; a published one is final.
    if (item.status === 'PUBLISHED') throw new ConflictException('A published icebreaker cannot be evaluated again');
    const rules = await this.db.db.query.icebreakerRules.findMany({ where: eq(icebreakerRules.isActive, true) });
    // FR-22: the local rules always run. The AI engine can add a block, never lift one.
    const local = rules.filter((rule) => matchesRule(rule, item.text));
    let remote: AiEvaluation | undefined;
    try {
      remote = await this.aiEngine.evaluate(item.text, rules.map((rule) => ({ code: rule.code, severity: rule.severity })));
      const unknown = remote?.violatedRules.filter((code) => !rules.some((rule) => rule.code === code)) ?? [];
      if (unknown.length) throw new Error(`ai-engine named rules that are not active: ${unknown.join(', ')}`);
    } catch (error) {
      await this.db.db.insert(icebreakerEvaluations).values({ icebreakerId: id, evaluator: 'AI_ENGINE', status: 'FAILED', result: { error: error instanceof Error ? error.message : 'Invalid AI response' } });
      throw new ConflictException('AI evaluation failed; the icebreaker was not published');
    }
    // A rule named by the engine on a BLOCKED verdict counts as broken even if its
    // own severity is a warning: the engine judged the text unpublishable for it.
    const remoteBroken = remote?.status === 'BLOCKED' ? rules.filter((rule) => remote!.violatedRules.includes(rule.code)) : [];
    const broken = [...new Map([...local, ...remoteBroken].map((rule) => [rule.id, rule])).values()];
    const blocking = local.some((rule) => rule.severity === 'BLOCKING') || remote?.status === 'BLOCKED';
    const status = blocking ? 'BLOCKED' : 'APPROVED';
    const matchedRules = broken.map((rule) => rule.code);
    await this.db.db.transaction(async (tx) => {
      await tx.insert(icebreakerEvaluations).values({ icebreakerId: id, evaluator: 'LOCAL_RULES', status: 'SUCCESS', result: { matchedRules: local.map((rule) => rule.code), blocking: local.some((rule) => rule.severity === 'BLOCKING') }, score: local.some((rule) => rule.severity === 'BLOCKING') ? '0' : '1' });
      if (remote) await tx.insert(icebreakerEvaluations).values({ icebreakerId: id, evaluator: 'AI_ENGINE', status: 'SUCCESS', result: { ...remote.result, verdict: remote.status, violatedRules: remote.violatedRules }, score: remote.score.toFixed(4), model: remote.model, tokenCostUsd: remote.tokenCostUsd?.toFixed(6) });
      // FR-25: every broken rule leaves a trace, whoever found it.
      if (broken.length) await tx.insert(icebreakerViolations).values(broken.map((rule) => ({ icebreakerId: id, ruleId: rule.id, severity: rule.severity, status: 'OPEN' })));
      // Compare-and-swap on the version read above: a concurrent edit or publish wins and this evaluation rolls back.
      const [moved] = await tx.update(icebreakers).set({ status, version: item.version + 1, updatedAt: new Date() }).where(and(eq(icebreakers.id, id), eq(icebreakers.version, item.version))).returning({ id: icebreakers.id });
      if (!moved) throw new ConflictException('Icebreaker changed during evaluation; evaluate it again');
    });
    await this.audit?.record({ actorType: 'USER', actorUserId: actor.sub, action: 'icebreaker.evaluated', entityType: 'icebreaker', entityId: id, result: 'SUCCESS', metadata: { profileId: item.profileId, status, source: remote ? 'AI_ENGINE' : 'LOCAL_RULES', count: matchedRules.length } });
    // FR-22: "Se indica qué regla específica fue incumplida": by name, not only by code.
    const violations = broken.map((rule) => ({ code: rule.code, name: rule.name, severity: rule.severity }));
    return { id, status, blocking, matchedRules, violations, ...(remote ? { score: remote.score, source: 'AI_ENGINE' as const } : { source: 'LOCAL_RULES' as const }) };
  }

  async publish(id: string, actor: IcebreakerActor) {
    const item = await this.db.db.query.icebreakers.findFirst({ where: and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub)) });
    if (!item || item.status !== 'APPROVED') throw new ConflictException('Icebreaker requires an approved evaluation');
    await this.assertAssignedProfile(item.profileId ?? undefined, actor);
    const [row] = await this.db.db.update(icebreakers).set({ status: 'PUBLISHED', publishedAt: new Date(), updatedAt: new Date(), version: sql`${icebreakers.version} + 1` }).where(and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub), eq(icebreakers.status, 'APPROVED'))).returning({ id: icebreakers.id, status: icebreakers.status, publishedAt: icebreakers.publishedAt });
    if (!row) throw new ConflictException('Icebreaker requires an approved evaluation');
    await this.audit?.record({ actorType: 'USER', actorUserId: actor.sub, action: 'icebreaker.published', entityType: 'icebreaker', entityId: id, result: 'SUCCESS', metadata: { status: 'PUBLISHED' } });
    return row;
  }

  /** FR-21: an icebreaker belongs to a profile the operator is assigned to right now. */
  private async assertAssignedProfile(profileId: string | undefined, actor: IcebreakerActor): Promise<void> {
    if (!profileId) return;
    const [assignment] = await this.db.db.select({ id: profileAssignments.id }).from(profileAssignments).where(and(eq(profileAssignments.operatorId, actor.sub), eq(profileAssignments.profileId, profileId), eq(profileAssignments.status, 'ACTIVE'), sql`${profileAssignments.validRange} @> now()`)).limit(1);
    if (!assignment) throw new ForbiddenException('The profile is not assigned to you right now');
  }

  async createRule(input: RuleInput, actorId: string) {
    const issue = rulePatternIssue(input.kind, input.pattern);
    if (issue) throw new BadRequestException(issue);
    const pattern = input.kind === 'MANUAL' ? null : input.pattern;
    const [row] = await this.db.db.insert(icebreakerRules).values({ ...input, pattern, createdBy: actorId }).returning({ id: icebreakerRules.id, code: icebreakerRules.code, severity: icebreakerRules.severity });
    await this.audit?.record({ actorType: 'USER', actorUserId: actorId, action: 'icebreaker.rule.created', entityType: 'icebreaker_rule', entityId: row.id, result: 'SUCCESS', metadata: { key: row.code } });
    return row;
  }

  async listRules() { return this.db.db.select({ id: icebreakerRules.id, code: icebreakerRules.code, name: icebreakerRules.name, kind: icebreakerRules.kind, pattern: icebreakerRules.pattern, severity: icebreakerRules.severity, isActive: icebreakerRules.isActive, version: icebreakerRules.version }).from(icebreakerRules).orderBy(asc(icebreakerRules.code)); }

  async updateRule(id: string, input: RuleUpdateInput, actorId?: string) {
    const { version, ...changes } = input;
    if (changes.kind !== undefined || changes.pattern !== undefined) {
      const [current] = await this.db.db.select({ kind: icebreakerRules.kind, pattern: icebreakerRules.pattern }).from(icebreakerRules).where(and(eq(icebreakerRules.id, id), eq(icebreakerRules.version, version))).limit(1);
      if (!current) throw new ConflictException('Rule was modified or not found');
      const kind = changes.kind ?? (current.kind as RuleKind);
      // Switching to MANUAL drops the old pattern instead of refusing the change.
      const pattern = kind === 'MANUAL' && changes.pattern === undefined ? null : changes.pattern !== undefined ? changes.pattern : current.pattern;
      const issue = rulePatternIssue(kind, pattern);
      if (issue) throw new BadRequestException(issue);
      changes.pattern = kind === 'MANUAL' ? null : pattern;
    }
    const [row] = await this.db.db.update(icebreakerRules).set({ ...changes, version: version + 1 }).where(and(eq(icebreakerRules.id, id), eq(icebreakerRules.version, version))).returning({ id: icebreakerRules.id, code: icebreakerRules.code, version: icebreakerRules.version, isActive: icebreakerRules.isActive });
    if (!row) throw new ConflictException('Rule was modified or not found');
    await this.audit?.record({
      actorType: actorId ? 'USER' : 'SYSTEM',
      actorUserId: actorId,
      action: 'icebreaker.rule.updated',
      entityType: 'icebreaker_rule',
      entityId: row.id,
      result: 'SUCCESS',
      metadata: { key: row.code, status: row.isActive ? 'ACTIVE' : 'INACTIVE', version: row.version },
    });
    return row;
  }

  async evaluations(id: string, actor: IcebreakerActor) { const item = await this.db.db.select({ id: icebreakers.id }).from(icebreakers).where(and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub))).limit(1); if (!item.length) throw new NotFoundException('Icebreaker not found'); return this.db.db.select().from(icebreakerEvaluations).where(eq(icebreakerEvaluations.icebreakerId, id)).orderBy(asc(icebreakerEvaluations.createdAt)); }

  async violations(filters: Partial<ViolationsQueryInput>, actor: IcebreakerActor) {
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_VIOLATIONS_LIMIT, 1), 200);
    return this.db.db
      .select({
        id: icebreakerViolations.id,
        icebreakerId: icebreakerViolations.icebreakerId,
        icebreakerText: icebreakers.text,
        icebreakerStatus: icebreakers.status,
        operatorId: icebreakers.operatorId,
        operatorName: users.fullName,
        profileId: icebreakers.profileId,
        profileName: ttProfiles.displayName,
        ruleId: icebreakerViolations.ruleId,
        ruleCode: icebreakerRules.code,
        ruleName: icebreakerRules.name,
        severity: icebreakerViolations.severity,
        status: icebreakerViolations.status,
        reviewedBy: icebreakerViolations.reviewedBy,
        reviewedAt: icebreakerViolations.reviewedAt,
        createdAt: icebreakerViolations.createdAt,
      })
      .from(icebreakerViolations)
      .innerJoin(icebreakers, eq(icebreakers.id, icebreakerViolations.icebreakerId))
      .innerJoin(icebreakerRules, eq(icebreakerRules.id, icebreakerViolations.ruleId))
      .innerJoin(users, eq(users.id, icebreakers.operatorId))
      .leftJoin(ttProfiles, eq(ttProfiles.id, icebreakers.profileId))
      .where(and(
        filters.operatorId ? eq(icebreakers.operatorId, filters.operatorId) : undefined,
        filters.status ? eq(icebreakerViolations.status, filters.status) : undefined,
        this.reviewerScope(actor),
        filters.from ? gte(icebreakerViolations.createdAt, bogotaDayStartUtc(filters.from)) : undefined,
        filters.to ? lt(icebreakerViolations.createdAt, bogotaNextDayStartUtc(filters.to)) : undefined,
      ))
      .orderBy(desc(icebreakerViolations.createdAt))
      .limit(limit);
  }

  async effectiveness(id: string, actor: IcebreakerActor) { const item = await this.db.db.select({ id: icebreakers.id }).from(icebreakers).where(and(eq(icebreakers.id, id), eq(icebreakers.operatorId, actor.sub))).limit(1); if (!item.length) throw new NotFoundException('Icebreaker not found'); return this.db.db.select().from(icebreakerEffectiveness).where(eq(icebreakerEffectiveness.operatorId, actor.sub)).orderBy(asc(icebreakerEffectiveness.businessDate)); }

  async review(id: string, input: ReviewInput, actor: IcebreakerActor) {
    const row = await this.db.db.transaction(async (tx) => {
      const item = await tx.query.icebreakers.findFirst({ where: and(eq(icebreakers.id, id), this.reviewerScope(actor)) });
      if (!item) throw new NotFoundException('Icebreaker not found');
      const now = new Date();
      const [created] = await tx.insert(icebreakerReviews).values({ icebreakerId: id, reviewerId: actor.sub, verdict: input.verdict, reason: input.reason }).returning({ id: icebreakerReviews.id, verdict: icebreakerReviews.verdict });
      await tx.update(icebreakerViolations).set({ status: 'REVIEWED', reviewedBy: actor.sub, reviewedAt: now }).where(and(eq(icebreakerViolations.icebreakerId, id), eq(icebreakerViolations.status, 'OPEN')));
      if (input.verdict === 'OVERRIDDEN_ALLOW' && item.status !== 'PUBLISHED') {
        await tx.update(icebreakers).set({ status: 'APPROVED', updatedAt: now, version: sql`${icebreakers.version} + 1` }).where(and(eq(icebreakers.id, id), sql`${icebreakers.status} != 'PUBLISHED'`));
      }
      return created;
    });
    await this.audit?.record({ actorType: 'USER', actorUserId: actor.sub, action: 'icebreaker.reviewed', entityType: 'icebreaker', entityId: id, result: 'SUCCESS', metadata: { outcome: input.verdict } });
    return row;
  }

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
