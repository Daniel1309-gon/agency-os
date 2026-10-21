import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { ttProfileCredentials, ttProfiles } from '../../database/schema/index.js';
import {
  createProfile,
  createTestContext,
  createUser,
  destroyTestContext,
  resetDatabase,
  seedRoles,
  type TestContext,
} from '../support/harness.js';

/**
 * The script runs in the ops container, which connects through DATABASE_APP_URL as the
 * runtime login (member of agency_app). tt_profile_credentials has FORCE ROW LEVEL SECURITY,
 * so the test must use that same kind of login: the owner or a superuser would bypass RLS.
 */
const script = fileURLToPath(new URL('../../../scripts/vault-restore-check.mjs', import.meta.url));
const RUNTIME_LOGIN = 'vault_check_runtime';
const RUNTIME_PASSWORD = 'vault-check-runtime-password';
const SECRET = 'synthetic-restore-secret';

let ctx: TestContext;
let runtimeUrl: string;
let owner: { id: string };

function runCheck(mode: 'seal' | 'open', env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [script, mode, 'restore-check', SECRET], {
    env: { ...process.env, DATABASE_APP_URL: runtimeUrl, DATABASE_RUNTIME_ROLE: 'app', BOOTSTRAP_ADMIN_EMAIL: 'Owner@Agency.test', ...env },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

beforeAll(async () => {
  ctx = await createTestContext();
  await ctx.pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_LOGIN}') THEN
      CREATE ROLE ${RUNTIME_LOGIN} LOGIN PASSWORD '${RUNTIME_PASSWORD}' IN ROLE agency_app;
    END IF;
  END $$`);
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.username = RUNTIME_LOGIN;
  url.password = RUNTIME_PASSWORD;
  runtimeUrl = url.toString();
});

afterAll(async () => {
  await destroyTestContext(ctx);
});

beforeEach(async () => {
  await resetDatabase(ctx);
  await seedRoles(ctx);
  await createUser(ctx, { role: 'ADMIN', email: 'other-admin@agency.test' });
  owner = await createUser(ctx, { role: 'ADMIN', email: 'owner@agency.test' });
  const profile = await createProfile(ctx);
  await ctx.db.update(ttProfiles).set({ externalRef: 'restore-check' }).where(eq(ttProfiles.id, profile.id));
});

describe('vault-restore-check', () => {
  it('seals a synthetic credential through the runtime role under forced RLS', async () => {
    const result = runCheck('seal');

    expect(result.output).toContain('sealed restore-check credential v1');
    expect(result.status).toBe(0);
    const rows = await ctx.db.select({ isCurrent: ttProfileCredentials.isCurrent, rotatedBy: ttProfileCredentials.rotatedBy }).from(ttProfileCredentials);
    expect(rows).toEqual([{ isCurrent: true, rotatedBy: owner.id }]);
  });

  it('opens the sealed credential through the runtime role with the configured KEK', async () => {
    expect(runCheck('seal').status).toBe(0);

    const result = runCheck('open');

    expect(result.output).toContain('opened restore-check credential');
    expect(result.status).toBe(0);
  });

  it('fails closed when the KEK differs from the one that sealed the credential', async () => {
    expect(runCheck('seal').status).toBe(0);

    const result = runCheck('open', { VAULT_KEK: 'a-different-kek-with-more-than-32-characters' });

    expect(result.status).toBe(1);
    expect(result.output).toContain('vault restore check failed: Unsupported state or unable to authenticate data');
  });
});
