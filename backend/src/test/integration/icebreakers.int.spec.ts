import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service.js';
import { IcebreakersService } from '../../modules/icebreakers/icebreakers.service.js';
import type { AiEngineClient, AiEvaluation } from '../../modules/icebreakers/ai-engine.client.js';
import { auditLog, icebreakerEvaluations, icebreakerRules, icebreakerViolations, icebreakers } from '../../database/schema/index.js';
import { createTestContext, createUser, destroyTestContext, resetDatabase, seedRoles, type TestContext } from '../support/harness.js';

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

    await expect(service.evaluate(id, actor)).resolves.toEqual({ id, status: 'APPROVED', blocking: false, matchedRules: [], score: 0.82, source: 'AI_ENGINE' });
    await expect(service.publish(id, actor)).resolves.toMatchObject({ status: 'PUBLISHED' });
  });

  it('still evaluates with the local rules alone when no engine is configured', async () => {
    const warning = await rule('SOFT_EMOJI', '😍', 'WARNING');
    const { actor, id } = await draft('Hola 😍');

    await expect(service.evaluate(id, actor)).resolves.toEqual({ id, status: 'APPROVED', blocking: false, matchedRules: ['SOFT_EMOJI'], source: 'LOCAL_RULES' });
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
