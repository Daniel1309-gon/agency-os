import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { rocketchatChannels } from '../../database/schema/index.js';
import { createTestContext, createUser, destroyTestContext, type TestContext } from '../support/harness.js';

const ROLE_NAMES = ['agency_owner', 'agency_app', 'agency_worker', 'agency_readonly'] as const;

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

async function asRole<T>(role: (typeof ROLE_NAMES)[number], run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    return await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

describe('PostgreSQL deployment roles', () => {
  it('creates non-login, non-superuser roles without RLS bypass', async () => {
    const result = await ctx.pool.query<{
      rolname: string;
      rolsuper: boolean;
      rolcanlogin: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      rolreplication: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolsuper, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
         FROM pg_roles
        WHERE rolname = ANY($1::text[])
        ORDER BY rolname`,
      [ROLE_NAMES],
    );

    expect(result.rows).toHaveLength(ROLE_NAMES.length);
    expect(result.rows).toEqual(
      ROLE_NAMES.slice()
        .sort()
        .map((rolname) => ({
          rolname,
          rolsuper: false,
          rolcanlogin: false,
          rolcreaterole: false,
          rolcreatedb: false,
          rolreplication: false,
          rolbypassrls: false,
        })),
    );
  });

  it('makes agency_owner the only owner of application tables', async () => {
    const result = await ctx.pool.query<{
      applicationTables: string;
      ownerTables: string;
      runtimeOwnedTables: string;
      nonOwnerTables: string;
    }>(`
      SELECT
        count(*) FILTER (WHERE relkind IN ('r', 'p'))::text AS "applicationTables",
        count(*) FILTER (WHERE relkind IN ('r', 'p') AND pg_get_userbyid(relowner) = 'agency_owner')::text AS "ownerTables",
        count(*) FILTER (WHERE relkind IN ('r', 'p') AND pg_get_userbyid(relowner) IN ('agency_app', 'agency_worker', 'agency_readonly'))::text AS "runtimeOwnedTables",
        count(*) FILTER (WHERE relkind IN ('r', 'p') AND pg_get_userbyid(relowner) <> 'agency_owner')::text AS "nonOwnerTables"
      FROM pg_class
      WHERE relnamespace = 'public'::regnamespace
    `);

    expect(Number(result.rows[0].applicationTables)).toBeGreaterThan(0);
    expect(result.rows[0].ownerTables).toBe(result.rows[0].applicationTables);
    expect(result.rows[0].runtimeOwnedTables).toBe('0');
    expect(result.rows[0].nonOwnerTables).toBe('0');
  });

  it('keeps application and worker grants bounded to their purpose', async () => {
    const result = await ctx.pool.query<{
      appRead: boolean;
      appInsert: boolean;
      appUpdate: boolean;
      appDelete: boolean;
      appTruncate: boolean;
      workerOutboxRead: boolean;
      workerOutboxInsert: boolean;
      workerOutboxUpdate: boolean;
      workerOutboxDelete: boolean;
      workerUsersRead: boolean;
      workerSettingsRead: boolean;
      workerTemplatesRead: boolean;
      workerOverridesRead: boolean;
      workerRolesRead: boolean;
      workerCrewMembersRead: boolean;
      workerShiftsInsert: boolean;
      workerShiftsDelete: boolean;
      workerScheduledInsert: boolean;
      workerAuditExecute: boolean;
      workerPayrollRead: boolean;
      workerCredentialsRead: boolean;
    }>(`
      SELECT
        has_table_privilege('agency_app', 'public.users', 'SELECT') AS "appRead",
        has_table_privilege('agency_app', 'public.users', 'INSERT') AS "appInsert",
        has_table_privilege('agency_app', 'public.users', 'UPDATE') AS "appUpdate",
        has_table_privilege('agency_app', 'public.users', 'DELETE') AS "appDelete",
        has_table_privilege('agency_app', 'public.users', 'TRUNCATE') AS "appTruncate",
        has_table_privilege('agency_worker', 'public.outbox_events', 'SELECT') AS "workerOutboxRead",
        has_table_privilege('agency_worker', 'public.outbox_events', 'INSERT') AS "workerOutboxInsert",
        has_table_privilege('agency_worker', 'public.outbox_events', 'UPDATE') AS "workerOutboxUpdate",
        has_table_privilege('agency_worker', 'public.outbox_events', 'DELETE') AS "workerOutboxDelete",
        has_table_privilege('agency_worker', 'public.users', 'SELECT') AS "workerUsersRead",
        has_table_privilege('agency_worker', 'public.app_settings', 'SELECT') AS "workerSettingsRead",
        has_table_privilege('agency_worker', 'public.shift_templates', 'SELECT') AS "workerTemplatesRead",
        has_table_privilege('agency_worker', 'public.shift_overrides', 'SELECT') AS "workerOverridesRead",
        has_table_privilege('agency_worker', 'public.roles', 'SELECT') AS "workerRolesRead",
        has_table_privilege('agency_worker', 'public.crew_members', 'SELECT') AS "workerCrewMembersRead",
        has_table_privilege('agency_worker', 'public.shifts', 'INSERT') AS "workerShiftsInsert",
        has_table_privilege('agency_worker', 'public.shifts', 'DELETE') AS "workerShiftsDelete",
        has_table_privilege('agency_worker', 'public.scheduled_messages', 'INSERT') AS "workerScheduledInsert",
        has_function_privilege('agency_worker', 'public.audit_log_maintain(int, int)', 'EXECUTE') AS "workerAuditExecute",
        has_table_privilege('agency_worker', 'public.payroll_lines', 'SELECT') AS "workerPayrollRead",
        has_table_privilege('agency_worker', 'public.tt_profile_credentials', 'SELECT') AS "workerCredentialsRead"
    `);

    expect(result.rows[0]).toEqual({
      appRead: true,
      appInsert: true,
      appUpdate: true,
      appDelete: false,
      appTruncate: false,
      workerOutboxRead: true,
      workerOutboxInsert: true,
      workerOutboxUpdate: true,
      workerOutboxDelete: false,
      workerUsersRead: true,
      workerSettingsRead: true,
      workerTemplatesRead: true,
      workerOverridesRead: true,
      workerRolesRead: true,
      workerCrewMembersRead: true,
      workerShiftsInsert: true,
      workerShiftsDelete: false,
      workerScheduledInsert: true,
      workerAuditExecute: true,
      workerPayrollRead: false,
      workerCredentialsRead: false,
    });
  });

  it('lets the worker role run the scheduler statements without reading secrets', async () => {
    const operator = await createUser(ctx);
    const [channel] = await ctx.db.insert(rocketchatChannels).values({ rcRoomId: 'worker-room', name: 'Worker', type: 'CHANNEL', purpose: 'GENERAL' }).returning({ id: rocketchatChannels.id });

    await expect(asRole('agency_worker', (client) => client.query('SELECT id FROM shift_templates LIMIT 1'))).resolves.toBeDefined();
    await expect(asRole('agency_worker', (client) => client.query('SELECT key FROM app_settings LIMIT 1'))).resolves.toBeDefined();
    await expect(asRole('agency_worker', (client) => client.query('SELECT id FROM shift_overrides LIMIT 1'))).resolves.toBeDefined();
    await expect(asRole('agency_worker', (client) => client.query('SELECT id FROM roles LIMIT 1'))).resolves.toBeDefined();
    await expect(asRole('agency_worker', (client) => client.query('SELECT user_id FROM crew_members LIMIT 1'))).resolves.toBeDefined();
    await expect(asRole('agency_worker', (client) => client.query('SELECT audit_log_maintain(2, 0)'))).resolves.toBeDefined();
    await expect(asRole('agency_worker', (client) => client.query(
      "INSERT INTO shifts (operator_id, business_date, status) VALUES ($1, '2026-09-22', 'SCHEDULED')",
      [operator.id],
    ))).resolves.toBeDefined();
    await expect(asRole('agency_worker', (client) => client.query(
      "INSERT INTO scheduled_messages (channel_id, body, scheduled_for, status) VALUES ($1, 'Siguiente ocurrencia', now() + interval '1 day', 'PENDING')",
      [channel.id],
    ))).resolves.toBeDefined();

    await expect(asRole('agency_worker', (client) => client.query('SELECT secret_ciphertext FROM tt_profile_credentials'))).rejects.toMatchObject({ code: '42501' });
    await expect(asRole('agency_worker', (client) => client.query('DELETE FROM shifts'))).rejects.toMatchObject({ code: '42501' });
  });

  it('allows authorized roles to compare citext identity columns', async () => {
    const result = await ctx.pool.query<{ ownerExecute: boolean; appExecute: boolean; readonlyExecute: boolean }>(`
      SELECT
        has_function_privilege('agency_owner', 'public.citext_eq(citext,citext)', 'EXECUTE') AS "ownerExecute",
        has_function_privilege('agency_app', 'public.citext_eq(citext,citext)', 'EXECUTE') AS "appExecute",
        has_function_privilege('agency_readonly', 'public.citext_eq(citext,citext)', 'EXECUTE') AS "readonlyExecute"
    `);

    expect(result.rows[0]).toEqual({ ownerExecute: true, appExecute: true, readonlyExecute: true });
    await expect(asRole('agency_owner', (client) => client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', ['missing@agency.test']))).resolves.toBeDefined();
    await expect(asRole('agency_app', (client) => client.query('SELECT id FROM users WHERE email = $1 LIMIT 1', ['missing@agency.test']))).resolves.toBeDefined();
  });

  it('allows readonly reporting columns but rejects secret columns and tables', async () => {
    const privileges = await ctx.pool.query<{
      roleRead: boolean;
      userEmailRead: boolean;
      userPasswordRead: boolean;
      credentialUsernameRead: boolean;
      credentialCiphertextRead: boolean;
      keyTableRead: boolean;
    }>(`
      SELECT
        has_table_privilege('agency_readonly', 'public.roles', 'SELECT') AS "roleRead",
        has_column_privilege('agency_readonly', 'public.users', 'email', 'SELECT') AS "userEmailRead",
        has_column_privilege('agency_readonly', 'public.users', 'password_hash', 'SELECT') AS "userPasswordRead",
        has_column_privilege('agency_readonly', 'public.tt_profile_credentials', 'username', 'SELECT') AS "credentialUsernameRead",
        has_column_privilege('agency_readonly', 'public.tt_profile_credentials', 'secret_ciphertext', 'SELECT') AS "credentialCiphertextRead",
        has_table_privilege('agency_readonly', 'public.encryption_keys', 'SELECT') AS "keyTableRead"
    `);

    expect(privileges.rows[0]).toEqual({
      roleRead: true,
      userEmailRead: true,
      userPasswordRead: false,
      credentialUsernameRead: true,
      credentialCiphertextRead: false,
      keyTableRead: false,
    });

    await expect(asRole('agency_readonly', (client) => client.query('SELECT password_hash FROM users'))).rejects.toMatchObject({ code: '42501' });
    await expect(asRole('agency_readonly', (client) => client.query('SELECT secret_ciphertext FROM tt_profile_credentials'))).rejects.toMatchObject({ code: '42501' });
  });
});
