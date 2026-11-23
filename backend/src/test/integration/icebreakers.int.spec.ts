import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { IcebreakersService } from '../../modules/icebreakers/icebreakers.service.js';
import { ruleSchema } from '../../modules/icebreakers/icebreakers.schemas.js';
import type { AiEngineClient, AiEvaluation } from '../../modules/icebreakers/ai-engine.client.js';
import { auditLog, crewMembers, crews, icebreakerEvaluations, icebreakerRules, icebreakerViolations, icebreakers, profileAssignments } from '../../database/schema/index.js';
import { createProfile, createTestContext, createUser, destroyTestContext, halfOpen, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

let ctx: TestContext;
/** What the fake engine answers next; undefined means "no engine configured". */
let verdict: AiEvaluation | undefined;
let service: IcebreakersService;

beforeAll(async () => {
  ctx = await createTestContext();
  const engine = { evaluate: async () => verdict } as unknown as AiEngineClient;
  service = new IcebreakersService(ctx.database, engine, new AuditService(ctx.database));
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
  verdict = undefined;
});

async function rule(code: string, pattern: string, severity: 'BLOCKING' | 'WARNING') {
  const [row] = await ctx.db.insert(icebreakerRules).values({ code, name: code, kind: 'KEYWORD', pattern, severity }).returning();
  return row;
}

async function draft(text: string) {
  const operator = await createUser(ctx);
  const actor = { sub: operator.id, role: 'OPERADOR' as const };
  const created = await service.create({ text }, actor);
  return { actor, id: created.id };
}

const approve = (score = 0.9): AiEvaluation => ({ status: 'APPROVED', score, violatedRules: [], result: {} });

async function violationsOf(id: string) {
  return ctx.db.select({ ruleId: icebreakerViolations.ruleId, severity: icebreakerViolations.severity }).from(icebreakerViolations).where(eq(icebreakerViolations.icebreakerId, id));
}

describe('IcebreakersService.evaluate (FR-22, FR-25)', () => {
  it('blocks on a BLOCKING local rule even when the AI engine approves the text', async () => {
    const contact = await rule('NO_CONTACT', 'whatsapp', 'BLOCKING');
    const { actor, id } = await draft('Hola, escríbeme al WhatsApp');
    verdict = approve();

    await expect(service.evaluate(id, actor)).resolves.toMatchObject({ status: 'BLOCKED', blocking: true, matchedRules: ['NO_CONTACT'], source: 'AI_ENGINE' });

    expect((await ctx.db.query.icebreakers.findFirst({ where: eq(icebreakers.id, id) }))?.status).toBe('BLOCKED');
    expect(await violationsOf(id)).toEqual([{ ruleId: contact.id, severity: 'BLOCKING' }]);
    const evaluators = await ctx.db.select({ evaluator: icebreakerEvaluations.evaluator }).from(icebreakerEvaluations).where(eq(icebreakerEvaluations.icebreakerId, id)).orderBy(asc(icebreakerEvaluations.evaluator));
    expect(evaluators.map((row) => row.evaluator)).toEqual(['AI_ENGINE', 'LOCAL_RULES']);
    await expect(service.publish(id, actor)).rejects.toThrow(ConflictException);
  });

  it('records the rule the AI engine names when it blocks a text no local rule caught', async () => {
    const tone = await rule('NO_PRESSURE', 'zzz-never-matches', 'WARNING');
    const { actor, id } = await draft('Contéstame ya o te bloqueo');
    verdict = { status: 'BLOCKED', score: 0.1, violatedRules: ['NO_PRESSURE'], result: { reason: 'presión' } };

    await expect(service.evaluate(id, actor)).resolves.toMatchObject({ status: 'BLOCKED', blocking: true, matchedRules: ['NO_PRESSURE'] });
    expect(await violationsOf(id)).toEqual([{ ruleId: tone.id, severity: 'WARNING' }]);
  });

  it('refuses an AI verdict that names a rule that is not active, and leaves the icebreaker unpublishable', async () => {
    await rule('NO_CONTACT', 'whatsapp', 'BLOCKING');
    const { actor, id } = await draft('Hola, ¿cómo estás?');
    verdict = { status: 'BLOCKED', score: 0.1, violatedRules: ['INVENTED'], result: {} };

    await expect(service.evaluate(id, actor)).rejects.toThrow(ConflictException);

    expect((await ctx.db.query.icebreakers.findFirst({ where: eq(icebreakers.id, id) }))?.status).toBe('DRAFT');
    const [failed] = await ctx.db.select().from(icebreakerEvaluations).where(eq(icebreakerEvaluations.icebreakerId, id));
    expect(failed).toMatchObject({ evaluator: 'AI_ENGINE', status: 'FAILED' });
    expect(await violationsOf(id)).toEqual([]);
  });

  it('approves a clean text when both the rules and the engine pass it', async () => {
    await rule('NO_CONTACT', 'whatsapp', 'BLOCKING');
    const { actor, id } = await draft('Hola, ¿qué tal tu día?');
    verdict = approve(0.82);

    await expect(service.evaluate(id, actor)).resolves.toEqual({ id, status: 'APPROVED', blocking: false, matchedRules: [], violations: [], score: 0.82, source: 'AI_ENGINE' });
    await expect(service.publish(id, actor)).resolves.toMatchObject({ status: 'PUBLISHED' });
  });

  it('still evaluates with the local rules alone when no engine is configured', async () => {
    const warning = await rule('SOFT_EMOJI', '😍', 'WARNING');
    const { actor, id } = await draft('Hola 😍');

    await expect(service.evaluate(id, actor)).resolves.toEqual({ id, status: 'APPROVED', blocking: false, matchedRules: ['SOFT_EMOJI'], violations: [{ code: 'SOFT_EMOJI', name: 'SOFT_EMOJI', severity: 'WARNING' }], source: 'LOCAL_RULES' });
    expect(await violationsOf(id)).toEqual([{ ruleId: warning.id, severity: 'WARNING' }]);
  });

  it('records audit entries for rule creation, evaluation, and publishing', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    await service.createRule({ code: 'NO_PHONE', name: 'No phone', kind: 'KEYWORD', pattern: 'tel:', severity: 'BLOCKING' }, admin.id);
    const { actor, id } = await draft('Hola, buen dia');
    verdict = approve(0.95);

    await service.evaluate(id, actor);
    await service.publish(id, actor);

    const actions = await ctx.db
      .select({ action: auditLog.action, metadata: auditLog.metadata })
      .from(auditLog)
      .orderBy(asc(auditLog.id));
    expect(actions).toEqual([
      { action: 'icebreaker.rule.created', metadata: { key: 'NO_PHONE' } },
      { action: 'icebreaker.evaluated', metadata: { profileId: null, status: 'APPROVED', source: 'AI_ENGINE', count: 0 } },
      { action: 'icebreaker.published', metadata: { status: 'PUBLISHED' } },
    ]);
  });
});

async function assign(operatorId: string, profileId: string, status = 'ACTIVE', from = new Date(Date.now() - 3_600_000), to = new Date(Date.now() + 3_600_000)) {
  const admin = await createUser(ctx, { role: 'ADMIN' });
  await ctx.db.insert(profileAssignments).values({ operatorId, profileId, status, validRange: halfOpen(from, to), assignedBy: admin.id });
}

describe('icebreaker workspace rules (FR-21, FR-22, FR-24)', () => {
  it('ties an icebreaker only to a profile the operator is currently assigned to', async () => {
    const operator = await createUser(ctx);
    const actor = { sub: operator.id, role: 'OPERADOR' as const };
    const mine = await createProfile(ctx);
    const notMine = await createProfile(ctx);
    const ended = await createProfile(ctx);
    await assign(operator.id, mine.id);
    await assign(operator.id, ended.id, 'ENDED', new Date(Date.now() - 7_200_000), new Date(Date.now() - 3_600_000));

    await expect(service.create({ profileId: mine.id, text: 'Hola' }, actor)).resolves.toMatchObject({ status: 'DRAFT' });
    await expect(service.create({ profileId: notMine.id, text: 'Hola' }, actor)).rejects.toThrow(ForbiddenException);
    await expect(service.create({ profileId: ended.id, text: 'Hola' }, actor)).rejects.toThrow(ForbiddenException);

    const draftOne = await service.create({ text: 'Sin perfil' }, actor);
    await expect(service.update(draftOne.id, { profileId: notMine.id, version: draftOne.version }, actor)).rejects.toThrow(ForbiddenException);
  });

  it('names each broken rule in the evaluation result', async () => {
    await ctx.db.insert(icebreakerRules).values({ code: 'NO_CONTACT', name: 'Prohibido pedir datos de contacto', kind: 'KEYWORD', pattern: 'whatsapp', severity: 'BLOCKING' });
    const { actor, id } = await draft('Dame tu WhatsApp');

    await expect(service.evaluate(id, actor)).resolves.toMatchObject({ status: 'BLOCKED', violations: [{ code: 'NO_CONTACT', name: 'Prohibido pedir datos de contacto', severity: 'BLOCKING' }] });
  });

  it('refuses to re-evaluate a published icebreaker, which keeps its status', async () => {
    const { actor, id } = await draft('Hola, ¿qué tal tu día?');
    await service.evaluate(id, actor);
    await service.publish(id, actor);

    await expect(service.evaluate(id, actor)).rejects.toThrow(ConflictException);
    expect((await ctx.db.query.icebreakers.findFirst({ where: eq(icebreakers.id, id) }))?.status).toBe('PUBLISHED');
  });

  it('refuses to publish an icebreaker whose profile is no longer assigned to the operator', async () => {
    const operator = await createUser(ctx);
    const actor = { sub: operator.id, role: 'OPERADOR' as const };
    const profile = await createProfile(ctx);
    await assign(operator.id, profile.id);
    const created = await service.create({ profileId: profile.id, text: 'Hola, ¿qué tal tu día?' }, actor);
    await service.evaluate(created.id, actor);
    await ctx.db.update(profileAssignments).set({ status: 'ENDED' }).where(eq(profileAssignments.operatorId, operator.id));

    await expect(service.publish(created.id, actor)).rejects.toThrow(ForbiddenException);
    expect((await ctx.db.query.icebreakers.findFirst({ where: eq(icebreakers.id, created.id) }))?.status).toBe('APPROVED');
  });

  it('increments the version on publish instead of resetting it', async () => {
    const { actor, id } = await draft('Hola, ¿qué tal tu día?');
    await service.evaluate(id, actor);
    const before = (await ctx.db.query.icebreakers.findFirst({ where: eq(icebreakers.id, id) }))!.version;

    await service.publish(id, actor);

    expect((await ctx.db.query.icebreakers.findFirst({ where: eq(icebreakers.id, id) }))!.version).toBe(before + 1);
  });
});

describe('icebreaker moderation queue and rule lifecycle (FR-25 to FR-27)', () => {
  it('enriches violations with operator/profile/rule metadata, scopes COORDINADOR to their crew, and marks violations REVIEWED on review', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const coord = await createUser(ctx, { role: 'COORDINADOR' });
    const inCrewOp = await createUser(ctx);
    const outCrewOp = await createUser(ctx);
    const profile = await createProfile(ctx);
    await assign(inCrewOp.id, profile.id);

    const [crew] = await ctx.db.insert(crews).values({ name: 'Crew Alpha', coordinatorId: coord.id, isActive: true }).returning({ id: crews.id });
    await ctx.db.insert(crewMembers).values({ crewId: crew.id, userId: inCrewOp.id, validRange: halfOpen(new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)) });

    await ctx.db.insert(icebreakerRules).values({ code: 'NO_WA', name: 'Sin WhatsApp', kind: 'KEYWORD', pattern: 'whatsapp', severity: 'BLOCKING' });
    const inCrewDraft = await service.create({ profileId: profile.id, text: 'Escríbeme por WhatsApp' }, { sub: inCrewOp.id, role: 'OPERADOR' });
    const outCrewDraft = await service.create({ text: 'También por WhatsApp' }, { sub: outCrewOp.id, role: 'OPERADOR' });
    await service.evaluate(inCrewDraft.id, { sub: inCrewOp.id, role: 'OPERADOR' });
    await service.evaluate(outCrewDraft.id, { sub: outCrewOp.id, role: 'OPERADOR' });

    const coordQueue = await service.violations({ status: 'OPEN' }, { sub: coord.id, role: 'COORDINADOR' });
    expect(coordQueue).toHaveLength(1);
    expect(coordQueue[0]).toMatchObject({
      icebreakerId: inCrewDraft.id,
      icebreakerText: 'Escríbeme por WhatsApp',
      icebreakerStatus: 'BLOCKED',
      operatorId: inCrewOp.id,
      profileId: profile.id,
      ruleCode: 'NO_WA',
      ruleName: 'Sin WhatsApp',
      severity: 'BLOCKING',
      status: 'OPEN',
    });
    expect(coordQueue[0].operatorName).toBeTruthy();
    expect(coordQueue[0].profileName).toBeTruthy();

    const adminQueue = await service.violations({ status: 'OPEN' }, { sub: admin.id, role: 'ADMIN' });
    expect(adminQueue).toHaveLength(2);

    await service.review(inCrewDraft.id, { verdict: 'OVERRIDDEN_ALLOW', reason: 'Falso positivo verificado' }, { sub: coord.id, role: 'COORDINADOR' });

    expect(await service.violations({ status: 'OPEN' }, { sub: coord.id, role: 'COORDINADOR' })).toHaveLength(0);
    const reviewed = await service.violations({ status: 'REVIEWED' }, { sub: coord.id, role: 'COORDINADOR' });
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]).toMatchObject({ status: 'REVIEWED', reviewedBy: coord.id, icebreakerStatus: 'APPROVED' });
    expect(reviewed[0].reviewedAt).toBeTruthy();
  });

  it('filters violations by Bogota calendar date across UTC midnight and toggles rules with audit trail', async () => {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const createdRule = await service.createRule({ code: 'NO_IG', name: 'Sin Instagram', kind: 'KEYWORD', pattern: 'instagram', severity: 'WARNING' }, admin.id);
    const { actor, id } = await draft('Sígueme en Instagram');
    await service.evaluate(id, actor);

    // 2026-11-22 22:30 Bogota = 2026-11-23 03:30 UTC
    await ctx.db.update(icebreakerViolations).set({ createdAt: new Date('2026-11-23T03:30:00.000Z') }).where(eq(icebreakerViolations.icebreakerId, id));

    expect(await service.violations({ from: '2026-11-22', to: '2026-11-22' }, { sub: admin.id, role: 'ADMIN' })).toHaveLength(1);
    expect(await service.violations({ from: '2026-11-23', to: '2026-11-23' }, { sub: admin.id, role: 'ADMIN' })).toHaveLength(0);

    const toggled = await service.updateRule(createdRule.id, { isActive: false, version: 1 }, admin.id);
    expect(toggled).toMatchObject({ id: createdRule.id, isActive: false, version: 2 });

    const auditActions = (await ctx.db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
    expect(auditActions).toContain('icebreaker.rule.updated');
  });

  it('rejects rules whose pattern cannot work, so one bad regex cannot block every icebreaker', async () => {
    const base = { code: 'R1', name: 'Rule', severity: 'BLOCKING' as const };
    expect(ruleSchema.safeParse({ ...base, kind: 'REGEX', pattern: '([a-z' }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, kind: 'REGEX' }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, kind: 'KEYWORD', pattern: '   ' }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, kind: 'MANUAL', pattern: 'tel:' }).success).toBe(false);
    expect(ruleSchema.safeParse({ ...base, kind: 'REGEX', pattern: '\\d{7,}' }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, kind: 'KEYWORD', pattern: 'tel:' }).success).toBe(true);
    expect(ruleSchema.safeParse({ ...base, kind: 'MANUAL' }).success).toBe(true);

    const admin = await createUser(ctx, { role: 'ADMIN' });
    const regex = await service.createRule({ ...base, code: 'PHONE', kind: 'REGEX', pattern: '\\d{7,}' }, admin.id);
    await expect(service.updateRule(regex.id, { pattern: '([a-z', version: 1 }, admin.id)).rejects.toThrow(BadRequestException);
    const keyword = await service.createRule({ ...base, code: 'IG', kind: 'KEYWORD', pattern: 'instagram' }, admin.id);
    await expect(service.updateRule(keyword.id, { kind: 'REGEX', version: 1 }, admin.id)).resolves.toMatchObject({ version: 2 });
    await expect(service.updateRule(keyword.id, { kind: 'REGEX', pattern: '(', version: 2 }, admin.id)).rejects.toThrow(BadRequestException);
    await expect(service.updateRule(keyword.id, { kind: 'MANUAL', version: 2 }, admin.id)).resolves.toMatchObject({ version: 3 });

    const stored = await ctx.db.select({ code: icebreakerRules.code, kind: icebreakerRules.kind, pattern: icebreakerRules.pattern, version: icebreakerRules.version }).from(icebreakerRules).orderBy(asc(icebreakerRules.code));
    expect(stored).toEqual([
      { code: 'IG', kind: 'MANUAL', pattern: null, version: 3 },
      { code: 'PHONE', kind: 'REGEX', pattern: '\\d{7,}', version: 1 },
    ]);
  });
});
