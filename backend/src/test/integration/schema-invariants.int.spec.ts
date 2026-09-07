import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  auditLog,
  crewMembers,
  crews,
  encryptionKeys,
  metricEvents,
  operatorAccountEntries,
  operatorCompensation,
  payrollPeriods,
  pointsLedger,
  profileAssignments,
  profileSessions,
  scheduledMessages,
  shifts,
  ttProfileCredentials,
  ttProfiles,
  users,
} from '../../database/schema/index.js';
import {
  createDevice,
  createProfile,
  createTestContext,
  createUser,
  destroyTestContext,
  halfOpen,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';
import { PG, expectRejectedBy } from '../support/pg-errors.js';

/**
 * Los invariantes de PLAN.md §4 se prueban contra Postgres porque solo existen
 * en Postgres: constraints de exclusion sobre tstzrange, indices unicos
 * parciales y triggers. Con dos instancias del backend, la carrera es real y el
 * unico arbitro es la base.
 */

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
});

const AUG = (day: number, hour = 0): Date => new Date(Date.UTC(2026, 7, day, hour, 0, 0));

describe('FR-08 — a profile cannot be assigned to two operators at once', () => {
  it('rejects an overlapping assignment window', async () => {
    const profile = await createProfile(ctx);
    const first = await createUser(ctx);
    const second = await createUser(ctx);

    await ctx.db.insert(profileAssignments).values({
      profileId: profile.id,
      operatorId: first.id,
      validRange: halfOpen(AUG(4, 6), AUG(4, 14)),
      status: 'ACTIVE',
      assignedBy: first.id,
    });

    await expectRejectedBy(
      PG.exclusionViolation,
      () =>
        ctx.db.insert(profileAssignments).values({
          profileId: profile.id,
          operatorId: second.id,
          validRange: halfOpen(AUG(4, 13), AUG(4, 20)),
          status: 'ACTIVE',
          assignedBy: second.id,
        }),
      'profile_assignments_no_overlap',
    );
  });

  it('accepts a handover at the exact boundary, because the ranges are half open', async () => {
    // PLAN.md §4.1: turnos consecutivos que se relevan a las 14:00. Con rangos
    // cerrados el relevo daria 409 y pareceria un bug del sistema.
    const profile = await createProfile(ctx);
    const morning = await createUser(ctx);
    const afternoon = await createUser(ctx);

    await ctx.db.insert(profileAssignments).values({
      profileId: profile.id,
      operatorId: morning.id,
      validRange: halfOpen(AUG(4, 6), AUG(4, 14)),
      status: 'ACTIVE',
      assignedBy: morning.id,
    });
    await ctx.db.insert(profileAssignments).values({
      profileId: profile.id,
      operatorId: afternoon.id,
      validRange: halfOpen(AUG(4, 14), AUG(4, 22)),
      status: 'ACTIVE',
      assignedBy: afternoon.id,
    });

    const rows = await ctx.db
      .select({ id: profileAssignments.id })
      .from(profileAssignments)
      .where(eq(profileAssignments.profileId, profile.id));
    expect(rows).toHaveLength(2);
  });

  it('lets a cancelled assignment be replaced in the same window', async () => {
    const profile = await createProfile(ctx);
    const first = await createUser(ctx);
    const second = await createUser(ctx);
    const range = halfOpen(AUG(5, 6), AUG(5, 14));

    const [cancelled] = await ctx.db
      .insert(profileAssignments)
      .values({ profileId: profile.id, operatorId: first.id, validRange: range, status: 'ACTIVE', assignedBy: first.id })
      .returning({ id: profileAssignments.id });
    await ctx.db.update(profileAssignments).set({ status: 'CANCELLED' }).where(eq(profileAssignments.id, cancelled.id));

    await expect(
      ctx.db
        .insert(profileAssignments)
        .values({ profileId: profile.id, operatorId: second.id, validRange: range, status: 'ACTIVE', assignedBy: second.id }),
    ).resolves.toBeDefined();
  });

  it('rejects a closed range, so nobody can reintroduce the overlap by hand', async () => {
    const profile = await createProfile(ctx);
    const operator = await createUser(ctx);

    await expectRejectedBy(
      PG.checkViolation,
      () =>
        ctx.db.insert(profileAssignments).values({
          profileId: profile.id,
          operatorId: operator.id,
          validRange: `[${AUG(6, 6).toISOString()},${AUG(6, 14).toISOString()}]`,
          status: 'ACTIVE',
          assignedBy: operator.id,
        }),
      'profile_assignments_half_open',
    );
  });
});

describe('FR-08 — a profile cannot hold two live sessions', () => {
  it('rejects a second LAUNCHING or ACTIVE session for the same profile', async () => {
    const profile = await createProfile(ctx);
    const operator = await createUser(ctx);
    const device = await createDevice(ctx, { operatorId: operator.id });
    const [assignment] = await ctx.db
      .insert(profileAssignments)
      .values({
        profileId: profile.id,
        operatorId: operator.id,
        validRange: halfOpen(AUG(4, 6), AUG(4, 14)),
        status: 'ACTIVE',
        assignedBy: operator.id,
      })
      .returning({ id: profileAssignments.id });

    const session = {
      profileId: profile.id,
      operatorId: operator.id,
      deviceId: device.id,
      assignmentId: assignment.id,
      chromeProfileDir: 'Profile 1',
    };
    const [live] = await ctx.db.insert(profileSessions).values(session).returning({ id: profileSessions.id });

    await expectRejectedBy(PG.uniqueViolation, () =>
      ctx.db.insert(profileSessions).values({ ...session, chromeProfileDir: 'Profile 2' }),
    );

    // Cerrada la primera, la segunda entra: el indice es parcial sobre los estados vivos.
    await ctx.db.update(profileSessions).set({ status: 'CLOSED', endedAt: new Date() }).where(eq(profileSessions.id, live.id));
    await expect(ctx.db.insert(profileSessions).values({ ...session, chromeProfileDir: 'Profile 2' })).resolves.toBeDefined();
  });
});

describe('shifts, crews and compensation cannot overlap', () => {
  it('rejects two overlapping shifts for one operator', async () => {
    const operator = await createUser(ctx);
    await ctx.db.insert(shifts).values({
      operatorId: operator.id,
      businessDate: '2026-08-04',
      scheduledRange: halfOpen(AUG(4, 6), AUG(4, 14)),
    });

    await expectRejectedBy(
      PG.exclusionViolation,
      () =>
        ctx.db.insert(shifts).values({
          operatorId: operator.id,
          businessDate: '2026-08-04',
          scheduledRange: halfOpen(AUG(4, 12), AUG(4, 20)),
        }),
      'shifts_no_overlap',
    );
  });

  it('rejects an operator belonging to two crews at the same time', async () => {
    const operator = await createUser(ctx);
    const [alpha] = await ctx.db.insert(crews).values({ name: 'Alpha' }).returning({ id: crews.id });
    const [beta] = await ctx.db.insert(crews).values({ name: 'Beta' }).returning({ id: crews.id });

    await ctx.db.insert(crewMembers).values({ crewId: alpha.id, userId: operator.id, validRange: halfOpen(AUG(1), AUG(15)) });

    await expectRejectedBy(
      PG.exclusionViolation,
      () => ctx.db.insert(crewMembers).values({ crewId: beta.id, userId: operator.id, validRange: halfOpen(AUG(10), AUG(20)) }),
      'crew_members_no_overlap',
    );
  });

  it('rejects two overlapping compensation rows, and a commission outside 0..1', async () => {
    const operator = await createUser(ctx);
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const row = { operatorId: operator.id, pointsToCopRate: '10.0000', createdBy: admin.id };

    await ctx.db.insert(operatorCompensation).values({ ...row, commissionRate: '0.3000', validRange: halfOpen(AUG(1), AUG(15)) });

    await expectRejectedBy(
      PG.exclusionViolation,
      () => ctx.db.insert(operatorCompensation).values({ ...row, commissionRate: '0.4000', validRange: halfOpen(AUG(10), AUG(20)) }),
      'operator_compensation_no_overlap',
    );

    await expectRejectedBy(
      PG.checkViolation,
      () => ctx.db.insert(operatorCompensation).values({ ...row, commissionRate: '1.5000', validRange: halfOpen(AUG(20), AUG(30)) }),
      'operator_compensation_rate_range',
    );
  });
});

describe('vault storage invariants', () => {
  it('keeps at most one current credential per profile', async () => {
    const profile = await createProfile(ctx);
    const admin = await createUser(ctx, { role: 'ADMIN' });
    await ctx.db.insert(encryptionKeys).values({ version: 1, wrappedDek: Buffer.alloc(60) });
    const credential = {
      profileId: profile.id,
      username: 'perfil@talky.test',
      secretCiphertext: Buffer.from('c'),
      secretNonce: Buffer.from('n'),
      secretTag: Buffer.from('t'),
      keyVersion: 1,
      aadContext: `${profile.id}:1`,
      rotatedBy: admin.id,
    };

    await ctx.db.insert(ttProfileCredentials).values({ ...credential, version: 1, isCurrent: true });

    await expectRejectedBy(PG.uniqueViolation, () =>
      ctx.db.insert(ttProfileCredentials).values({ ...credential, version: 2, isCurrent: true }),
    );

    // Rotar correctamente es bajar la anterior y subir la nueva.
    await ctx.db
      .update(ttProfileCredentials)
      .set({ isCurrent: false })
      .where(and(eq(ttProfileCredentials.profileId, profile.id), eq(ttProfileCredentials.isCurrent, true)));
    await expect(ctx.db.insert(ttProfileCredentials).values({ ...credential, version: 2, isCurrent: true })).resolves.toBeDefined();
  });
});

describe('decision #15 — metric ingestion is idempotent', () => {
  it('rejects the same dedupeKey at the same instant', async () => {
    const profile = await createProfile(ctx);
    const occurredAt = new Date('2026-08-04T10:00:00.000Z');
    const event = { dedupeKey: 'sha256-abc', profileId: profile.id, eventType: 'POINTS', points: '10.0000', occurredAt };

    await ctx.db.insert(metricEvents).values(event);
    await expectRejectedBy(PG.uniqueViolation, () => ctx.db.insert(metricEvents).values(event));
  });
});

describe('FR-35 — a delivered order is debited once', () => {
  it('rejects a second debit for the same order', async () => {
    const operator = await createUser(ctx);
    const reference = '77777777-7777-7777-7777-777777777777';
    const entry = {
      operatorId: operator.id,
      entryType: 'DEBIT_CAFETERIA',
      amountCop: '-15000.00',
      referenceType: 'cafeteria_order',
      referenceId: reference,
      businessDate: '2026-08-04',
    };

    await ctx.db.insert(operatorAccountEntries).values(entry);
    await expectRejectedBy(PG.uniqueViolation, () => ctx.db.insert(operatorAccountEntries).values(entry));

    // Un reembolso sobre el mismo pedido si es otra clase de asiento.
    await expect(
      ctx.db.insert(operatorAccountEntries).values({ ...entry, entryType: 'CREDIT_REFUND', amountCop: '15000.00' }),
    ).resolves.toBeDefined();
  });
});

describe('decision #8 — the audit log cannot carry a secret in a first-level key', () => {
  it('rejects the forbidden keys and accepts ordinary context', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    const base = { actorType: 'USER', actorUserId: actor.id, action: 'vault.credential.issued', result: 'SUCCESS' };

    for (const key of ['password', 'secret', 'token', 'credential', 'plaintext', 'secret_ciphertext']) {
      await expectRejectedBy(
        PG.checkViolation,
        () => ctx.db.insert(auditLog).values({ ...base, metadata: { [key]: 'hunter2' } }),
        'audit_log_no_secret_keys',
      );
    }

    await expect(
      ctx.db.insert(auditLog).values({ ...base, metadata: { profileId: 'p-1', grantId: 'g-1', denyReason: 'OUT_OF_SHIFT' } }),
    ).resolves.toBeDefined();
  });

  it('does not catch a nested secret — the CHECK is a last resort, not the defence', async () => {
    // PLAN.md §3.1 lo advierte explicitamente: jsonb_exists_any solo mira
    // claves de primer nivel. La defensa real es el allowlist del serializador.
    const actor = await createUser(ctx, { role: 'ADMIN' });
    await expect(
      ctx.db.insert(auditLog).values({
        actorType: 'USER',
        actorUserId: actor.id,
        action: 'vault.credential.issued',
        result: 'SUCCESS',
        metadata: { context: { password: 'hunter2' } },
      }),
    ).resolves.toBeDefined();
  });
});

describe('audit_log is partitioned by month and stays append-only in every partition', () => {
  it('routes an insert into the partition of its month', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    await ctx.pool.query("SELECT audit_log_ensure_partition('2026-09-01'::date)");
    await ctx.db.insert(auditLog).values({
      actorType: 'USER',
      actorUserId: actor.id,
      action: 'setting.updated',
      result: 'SUCCESS',
      occurredAt: new Date('2026-09-15T12:00:00Z'),
    });

    const routed = await ctx.pool.query(
      "SELECT tableoid::regclass::text AS partition FROM audit_log WHERE occurred_at = '2026-09-15T12:00:00Z'",
    );
    expect(routed.rows[0].partition).toBe('audit_log_2026_09');
  });

  it('rejects TRUNCATE on a partition, not only on the parent', async () => {
    // Los triggers de fila se clonan a cada particion, pero los de TRUNCATE no. Sin un
    // trigger por particion, truncar audit_log_2026_09 borraria un mes de auditoria
    // saltandose la inmutabilidad de 0004. Esta prueba es la que guarda ese hueco.
    await ctx.pool.query("SELECT audit_log_ensure_partition('2026-09-01'::date)");
    await expect(ctx.pool.query('TRUNCATE audit_log')).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('TRUNCATE audit_log_2026_09')).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('TRUNCATE audit_log_default')).rejects.toThrow(/append-only/);
  });

  it('keeps UPDATE and DELETE rejected after partitioning', async () => {
    const actor = await createUser(ctx, { role: 'ADMIN' });
    await ctx.db.insert(auditLog).values({
      actorType: 'USER',
      actorUserId: actor.id,
      action: 'setting.updated',
      result: 'SUCCESS',
    });

    await expect(ctx.pool.query("UPDATE audit_log SET action = 'tampered'")).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });

  it('creates partitions ahead and drops only what the retention leaves behind', async () => {
    const old = 'audit_log_2020_01';
    await ctx.pool.query("SELECT audit_log_ensure_partition('2020-01-01'::date)");
    const before = await ctx.pool.query('SELECT to_regclass($1) AS present', [old]);
    expect(before.rows[0].present).toBe(old);

    // Retencion 0 = OQ-08 abierta = no se borra nada.
    const kept = await ctx.pool.query('SELECT audit_log_maintain(2, 0) AS result');
    expect(kept.rows[0].result.dropped).toEqual([]);
    expect((await ctx.pool.query('SELECT to_regclass($1) AS present', [old])).rows[0].present).toBe(old);

    // Con retencion de 12 meses, una particion de 2020 ya esta vencida.
    const swept = await ctx.pool.query('SELECT audit_log_maintain(2, 12) AS result');
    expect(swept.rows[0].result.dropped).toContain(old);
    expect((await ctx.pool.query('SELECT to_regclass($1) AS present', [old])).rows[0].present).toBeNull();
  });

  it('creates the current month and the next two, and never drops the default partition', async () => {
    const result = await ctx.pool.query('SELECT audit_log_maintain(2, 1) AS result');
    expect(result.rows[0].result.dropped).not.toContain('audit_log_default');

    const months = await ctx.pool.query(`
      SELECT count(*)::int AS total
      FROM pg_inherits inh
      INNER JOIN pg_class child ON child.oid = inh.inhrelid
      WHERE inh.inhparent = 'public.audit_log'::regclass
        AND child.relname ~ '^audit_log_[0-9]{4}_[0-9]{2}$'
        AND to_date(right(child.relname, 7), 'YYYY_MM')
            >= date_trunc('month', now() AT TIME ZONE 'UTC')::date
    `);
    expect(months.rows[0].total).toBeGreaterThanOrEqual(3);
    expect((await ctx.pool.query("SELECT to_regclass('audit_log_default') AS present")).rows[0].present).toBe('audit_log_default');
  });
});

describe('a closed payroll period is closed for writing', () => {
  it('rejects ledger and account writes inside a CLOSED or PAID period', async () => {
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    const [period] = await ctx.db
      .insert(payrollPeriods)
      .values({ name: 'Agosto', startsOn: '2026-08-01', endsOn: '2026-08-31', defaultPointsToCopRate: '10.0000', status: 'CLOSED' })
      .returning({ id: payrollPeriods.id });

    await expectRejectedBy(PG.checkViolation, () =>
      ctx.db.insert(pointsLedger).values({
        operatorId: operator.id,
        profileId: profile.id,
        businessDate: '2026-08-15',
        shiftBusinessDate: '2026-08-15',
        points: '10.0000',
        source: 'TABLEAU_ETL',
      }),
    );

    await expectRejectedBy(PG.checkViolation, () =>
      ctx.db.insert(operatorAccountEntries).values({
        operatorId: operator.id,
        entryType: 'DEBIT_CAFETERIA',
        amountCop: '-1000.00',
        referenceType: 'cafeteria_order',
        referenceId: '88888888-8888-8888-8888-888888888888',
        businessDate: '2026-08-15',
      }),
    );

    // Fuera del periodo cerrado se escribe con normalidad.
    await expect(
      ctx.db.insert(pointsLedger).values({
        operatorId: operator.id,
        profileId: profile.id,
        businessDate: '2026-09-01',
        shiftBusinessDate: '2026-09-01',
        points: '10.0000',
        source: 'TABLEAU_ETL',
      }),
    ).resolves.toBeDefined();

    // Y mientras sigue OPEN, tampoco estorba.
    await ctx.db.update(payrollPeriods).set({ status: 'OPEN' }).where(eq(payrollPeriods.id, period.id));
    await expect(
      ctx.db.insert(pointsLedger).values({
        operatorId: operator.id,
        profileId: profile.id,
        businessDate: '2026-08-15',
        shiftBusinessDate: '2026-08-15',
        points: '10.0000',
        source: 'TABLEAU_ETL',
      }),
    ).resolves.toBeDefined();
  });
});

describe('identity and messaging invariants', () => {
  it('keeps emails unique among live users, and frees them on soft delete', async () => {
    const roleIds = await seedRoles(ctx);
    const roleId = roleIds.get('OPERADOR');
    const row = { email: 'carol@agency.test', fullName: 'Carol', passwordHash: 'scrypt$x', roleId: roleId as string };

    const [first] = await ctx.db.insert(users).values(row).returning({ id: users.id });
    await expectRejectedBy(PG.uniqueViolation, () => ctx.db.insert(users).values(row));

    // citext: la misma direccion con otra caja sigue siendo la misma persona.
    await expectRejectedBy(PG.uniqueViolation, () => ctx.db.insert(users).values({ ...row, email: 'Carol@Agency.test' }));

    await ctx.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, first.id));
    await expect(ctx.db.insert(users).values(row)).resolves.toBeDefined();
  });

  it('requires a scheduled message to target exactly one destination', async () => {
    const user = await createUser(ctx);
    const message = { body: 'recordatorio', scheduledFor: new Date() };

    await expectRejectedBy(
      PG.checkViolation,
      () => ctx.db.insert(scheduledMessages).values(message),
      'scheduled_messages_exactly_one_target',
    );
    await expect(ctx.db.insert(scheduledMessages).values({ ...message, targetUserId: user.id })).resolves.toBeDefined();
  });

  it('refuses a profile login email reused while the profile is alive', async () => {
    const [profile] = await ctx.db
      .insert(ttProfiles)
      .values({ displayName: 'Ana', loginEmail: 'ana@talky.test' })
      .returning({ id: ttProfiles.id });

    await expectRejectedBy(PG.uniqueViolation, () =>
      ctx.db.insert(ttProfiles).values({ displayName: 'Ana bis', loginEmail: 'ana@talky.test' }),
    );

    await ctx.db.update(ttProfiles).set({ deletedAt: new Date() }).where(eq(ttProfiles.id, profile.id));
    await expect(ctx.db.insert(ttProfiles).values({ displayName: 'Ana bis', loginEmail: 'ana@talky.test' })).resolves.toBeDefined();
  });
});
