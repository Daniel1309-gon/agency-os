import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('host initialization creates file-backed secrets, SAN certificates and a /32 firewall rule', async () => {
  const script = await readFile(new URL('../deploy/station-e2e/initialize-host.ps1', import.meta.url), 'utf8');
  assert.match(script, /app\.agency-os\.test/);
  assert.match(script, /api\.agency-os\.test/);
  assert.match(script, /subjectAltName/);
  assert.match(script, /New-NetFirewallRule/);
  assert.match(script, /-RemoteAddress \$StationAddress/);
  assert.match(script, /database_app_url/);
  assert.match(script, /agency_runtime/);
  assert.match(script, /database_worker_url/);
  assert.match(script, /agency_worker_runtime/);
  assert.match(script, /package-managed-extension\.mjs/);
  assert.doesNotMatch(script, /docker compose down.+(?:-v|--volumes)/);
  // Windows PowerShell 5.1 runs on .NET Framework, which has no RandomNumberGenerator::Fill.
  assert.match(script, /RandomNumberGenerator\]::Create\(\)/);
  assert.doesNotMatch(script, /RandomNumberGenerator\]::Fill/);
});
