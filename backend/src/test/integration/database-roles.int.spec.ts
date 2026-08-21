import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { createTestContext, destroyTestContext, type TestContext } from '../support/harness.js';

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
      workerPayrollRead: false,
      workerCredentialsRead: false,
    });
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
