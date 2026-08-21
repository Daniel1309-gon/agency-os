import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import {
  encryptionKeys,
  auditLog,
  icebreakers,
  operatorAccountEntries,
  pointsLedger,
  profileAssignments,
  ttProfileCredentials,
} from '../../database/schema/index.js';
import {
  createProfile,
  createTestContext,
  createUser,
  destroyTestContext,
  halfOpen,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

/**
 * RLS es la defensa en profundidad de PLAN.md §6.5: si un servicio olvida su
 * filtro por operador, la base tiene que negar igual.
 *
 * Las pruebas corren bajo el rol real de runtime HTTP. El dueño salta RLS por
 * definición de PostgreSQL (salvo FORCE ROW LEVEL SECURITY), así que usar un
 * rol artificial ocultaría si los grants y el rol desplegado están alineados.
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

/**
 * Ejecuta una consulta como lo haría un request: el rol real de API y las
 * variables de sesion que fija DatabaseService.withRequestContext. Siempre en
 * una transaccion que se deshace, para no dejar rastro.
 */
async function asRequest<T>(
  identity: { userId?: string; roleCode?: string },
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return asRole('agency_app', identity, run);
}

async function asRole<T>(
  databaseRole: string,
  identity: { userId?: string; roleCode?: string },
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${databaseRole}`);
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', identity.userId ?? '']);
    await client.query('SELECT set_config($1, $2, true)', ['app.role_code', identity.roleCode ?? '']);
    return await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

const countOf = async (client: PoolClient, table: string): Promise<number> => {
  const result = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
  return result.rows[0].n as number;
};

describe('points_ledger row level security', () => {
  it('does not let the owner role bypass policies without request context', async () => {
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await ctx.db.insert(pointsLedger).values({
      operatorId: operator.id,
      profileId: profile.id,
      businessDate: '2026-08-04',
      shiftBusinessDate: '2026-08-04',
      points: '100.0000',
      source: 'TABLEAU_ETL',
    });

    await asRole('agency_owner', {}, async (client) => {
      expect(await countOf(client, 'points_ledger')).toBe(0);
    });
  });

  it('denies everything when app.user_id is empty', async () => {
    // Criterio de entrega de PLAN.md §9: sin identidad, las politicas niegan,
    // no permiten. Un `NULLIF(...,'')::uuid` mal escrito abriria la tabla entera.
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await ctx.db.insert(pointsLedger).values({
      operatorId: operator.id,
      profileId: profile.id,
      businessDate: '2026-08-04',
      shiftBusinessDate: '2026-08-04',
      points: '100.0000',
      source: 'TABLEAU_ETL',
    });

    await asRequest({}, async (client) => {
      expect(await countOf(client, 'points_ledger')).toBe(0);
    });
  });

  it('shows an operator their own rows and nobody else', async () => {
    const mine = await createUser(ctx);
    const theirs = await createUser(ctx);
    const profile = await createProfile(ctx);
    for (const operatorId of [mine.id, theirs.id]) {
      await ctx.db.insert(pointsLedger).values({
        operatorId,
        profileId: profile.id,
        businessDate: '2026-08-04',
        shiftBusinessDate: '2026-08-04',
        points: '100.0000',
        source: 'TABLEAU_ETL',
      });
    }

    await asRequest({ userId: mine.id, roleCode: 'OPERADOR' }, async (client) => {
      const rows = await client.query('SELECT operator_id FROM points_ledger');
      expect(rows.rows).toEqual([{ operator_id: mine.id }]);
    });
  });

  it('shows everything to an administrator', async () => {
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);
    await ctx.db.insert(pointsLedger).values({
      operatorId: operator.id,
      profileId: profile.id,
      businessDate: '2026-08-04',
      shiftBusinessDate: '2026-08-04',
      points: '100.0000',
      source: 'TABLEAU_ETL',
    });

    await asRequest({ userId: operator.id, roleCode: 'ADMIN' }, async (client) => {
      expect(await countOf(client, 'points_ledger')).toBe(1);
    });
  });

  it('refuses an operator writing points for themselves', async () => {
    // Los puntos son dinero: solo los escribe el sistema.
    const operator = await createUser(ctx);
    const profile = await createProfile(ctx);

    await asRequest({ userId: operator.id, roleCode: 'OPERADOR' }, async (client) => {
      await expect(
        client.query(
          `INSERT INTO points_ledger (operator_id, profile_id, business_date, shift_business_date, points, source)
           VALUES ($1, $2, '2026-08-04', '2026-08-04', '9999.0000', 'MANUAL_ADJUSTMENT')`,
          [operator.id, profile.id],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

describe('operator_account_entries row level security', () => {
  it('keeps one operator balance away from another', async () => {
    const mine = await createUser(ctx);
    const theirs = await createUser(ctx);
    for (const [index, operatorId] of [mine.id, theirs.id].entries()) {
      await ctx.db.insert(operatorAccountEntries).values({
        operatorId,
        entryType: 'DEBIT_CAFETERIA',
        amountCop: '-1000.00',
        referenceType: 'cafeteria_order',
        referenceId: `0000000${index}-0000-0000-0000-000000000000`,
        businessDate: '2026-08-04',
      });
    }

    await asRequest({ userId: mine.id, roleCode: 'OPERADOR' }, async (client) => {
      expect(await countOf(client, 'operator_account_entries')).toBe(1);
    });
    await asRequest({}, async (client) => {
      expect(await countOf(client, 'operator_account_entries')).toBe(0);
    });
  });
});

describe('icebreakers row level security', () => {
  it('scopes reading and writing to the author', async () => {
    const author = await createUser(ctx);
    const other = await createUser(ctx);
    await ctx.db.insert(icebreakers).values({ operatorId: author.id, text: 'hola, como estas?' });

    await asRequest({ userId: other.id, roleCode: 'OPERADOR' }, async (client) => {
      expect(await countOf(client, 'icebreakers')).toBe(0);
      // Y tampoco puede firmar uno a nombre ajeno.
      await expect(
        client.query('INSERT INTO icebreakers (operator_id, text) VALUES ($1, $2)', [author.id, 'suplantado']),
      ).rejects.toMatchObject({ code: '42501' });
    });

    await asRequest({ userId: author.id, roleCode: 'OPERADOR' }, async (client) => {
      expect(await countOf(client, 'icebreakers')).toBe(1);
    });
  });
});

describe('tt_profile_credentials row level security', () => {
  async function seedCredential(): Promise<{ profileId: string; assignedOperatorId: string; strangerId: string }> {
    const admin = await createUser(ctx, { role: 'ADMIN' });
    const assigned = await createUser(ctx);
    const stranger = await createUser(ctx);
    const profile = await createProfile(ctx);
    await ctx.db.insert(encryptionKeys).values({ version: 1, wrappedDek: Buffer.alloc(60) });
    await ctx.db.insert(ttProfileCredentials).values({
      profileId: profile.id,
      username: 'perfil@talky.test',
      secretCiphertext: Buffer.from('c'),
      secretNonce: Buffer.from('n'),
      secretTag: Buffer.from('t'),
      keyVersion: 1,
      aadContext: `${profile.id}:1`,
      version: 1,
      isCurrent: true,
      rotatedBy: admin.id,
    });
    await ctx.db.insert(profileAssignments).values({
      profileId: profile.id,
      operatorId: assigned.id,
      validRange: halfOpen(new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)),
      status: 'ACTIVE',
      assignedBy: admin.id,
    });
    return { profileId: profile.id, assignedOperatorId: assigned.id, strangerId: stranger.id };
  }

  it('only lets the operator on a current assignment see the row', async () => {
    const { assignedOperatorId, strangerId } = await seedCredential();

    await asRequest({ userId: assignedOperatorId, roleCode: 'OPERADOR' }, async (client) => {
      expect(await countOf(client, 'tt_profile_credentials')).toBe(1);
    });
    await asRequest({ userId: strangerId, roleCode: 'OPERADOR' }, async (client) => {
      expect(await countOf(client, 'tt_profile_credentials')).toBe(0);
    });
    await asRequest({}, async (client) => {
      expect(await countOf(client, 'tt_profile_credentials')).toBe(0);
    });
  });

  it('closes access as soon as the assignment stops being current', async () => {
    const { assignedOperatorId, profileId } = await seedCredential();
    await ctx.pool.query(
      `UPDATE profile_assignments SET valid_range = tstzrange(now() - interval '2 hours', now() - interval '1 hour', '[)') WHERE profile_id = $1`,
      [profileId],
    );

    await asRequest({ userId: assignedOperatorId, roleCode: 'OPERADOR' }, async (client) => {
      expect(await countOf(client, 'tt_profile_credentials')).toBe(0);
    });
  });

  it('refuses an operator writing a credential, even for their own profile', async () => {
    const { assignedOperatorId, profileId } = await seedCredential();

    await asRequest({ userId: assignedOperatorId, roleCode: 'OPERADOR' }, async (client) => {
      await expect(
        client.query(
          `INSERT INTO tt_profile_credentials
             (profile_id, username, secret_ciphertext, secret_nonce, secret_tag, key_version, aad_context, version, is_current, rotated_by)
           VALUES ($1, 'yo@talky.test', '\\x00', '\\x00', '\\x00', 1, $2, 2, false, $3)`,
          [profileId, `${profileId}:2`, assignedOperatorId],
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

describe('agency_app deployment role', () => {
  it('exists as a non-owner role and cannot mutate or truncate audit_log', async () => {
    const role = await ctx.pool.query<{ rolname: string; rolsuper: boolean; rolcanlogin: boolean }>(
      "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = 'agency_app'",
    );
    expect(role.rows).toEqual([{ rolname: 'agency_app', rolsuper: false, rolcanlogin: false }]);

    const [entry] = await ctx.db
      .insert(auditLog)
      .values({ actorType: 'SYSTEM', action: 'test.audit', result: 'SUCCESS' })
      .returning({ id: auditLog.id });
    await asRole('agency_app', { roleCode: 'ADMIN' }, async (client) => {
      await expect(client.query('UPDATE audit_log SET result = $1 WHERE id = $2', ['TAMPERED', entry.id])).rejects.toMatchObject({ code: '42501' });
    });
    await asRole('agency_app', { roleCode: 'ADMIN' }, async (client) => {
      await expect(client.query('DELETE FROM audit_log WHERE id = $1', [entry.id])).rejects.toMatchObject({ code: '42501' });
    });
    await asRole('agency_app', { roleCode: 'ADMIN' }, async (client) => {
      await expect(client.query('TRUNCATE audit_log')).rejects.toMatchObject({ code: '42501' });
    });

    const ownerClient = await ctx.pool.connect();
    try {
      await expect(ownerClient.query('UPDATE audit_log SET result = $1 WHERE id = $2', ['TAMPERED', entry.id])).rejects.toMatchObject({ code: '42501' });
      await expect(ownerClient.query('TRUNCATE audit_log')).rejects.toMatchObject({ code: '42501' });
    } finally {
      ownerClient.release();
    }
  });
});
