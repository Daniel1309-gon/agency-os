import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

/** GHSA ids listed under `auditConfig.ignoreGhsas` in pnpm-workspace.yaml. */
function ignoredGhsas(workspaceYaml) {
  const block = workspaceYaml.match(/^auditConfig:\n {2}ignoreGhsas:\n((?: {4}- .+\n?)+)/m);
  if (!block) return [];
  return block[1].split('\n').map((line) => line.replace(/^ {4}- /, '').trim()).filter(Boolean);
}

test('every ignored audit advisory is registered with a reason and an expiry that has not passed', async () => {
  const [workspaceYaml, registerJson] = await Promise.all([
    readFile(new URL('pnpm-workspace.yaml', root), 'utf8'),
    readFile(new URL('docs/security/audit-exceptions.json', root), 'utf8'),
  ]);
  const register = JSON.parse(registerJson);
  const today = new Date().toISOString().slice(0, 10);

  // A reformatted list (for example inline `ignoreGhsas: [...]`) would parse as empty and hide exceptions.
  if (/ignoreGhsas/.test(workspaceYaml)) {
    assert.ok(ignoredGhsas(workspaceYaml).length > 0, 'write auditConfig.ignoreGhsas as a block list so this test can read it');
  }
  assert.deepEqual([...ignoredGhsas(workspaceYaml)].sort(), register.map((entry) => entry.ghsa).sort());
  for (const entry of register) {
    assert.match(entry.ghsa, /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
    assert.ok(entry.package && entry.reason && entry.remediation, `${entry.ghsa} needs package, reason and remediation`);
    assert.match(entry.expires, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.expires >= today, `${entry.ghsa} audit exception expired on ${entry.expires}: remediate it or renew it with a new justification`);
  }
});
