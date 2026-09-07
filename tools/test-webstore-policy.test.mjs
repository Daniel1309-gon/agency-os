import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('policy preview never writes and refuses collisions without changing other extensions', { skip: process.platform !== 'win32' }, () => {
  // Stub only the registry boundary; never write real Chrome policy during tests.
  const prelude = `
    $ErrorActionPreference = 'Stop'
    function Test-Path { param($LiteralPath) return $true }
    function Get-ItemProperty { param($LiteralPath) return [pscustomobject]@{ '1001' = $global:registryValue } }
    function New-Item { throw 'Unexpected registry write' }
    function New-ItemProperty { throw 'Unexpected registry write' }
  `;
  for (const existing of ['', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;http://localhost:8765/update.xml', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;https://clients2.google.com/service/update2/crx']) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `${prelude}
      $global:registryValue = '${existing}'
      & ./extension/scripts/install-webstore-policy.ps1 -ExtensionId aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -WhatIf
    `], { cwd: root, encoding: 'utf8' });
    assert.doesNotMatch(result.stderr, /Unexpected registry write/);
    if (existing.startsWith('b')) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ValueName/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
      assert.match(result.stdout, /https:\/\/clients2\.google\.com\/service\/update2\/crx/);
    }
  }
  const invalid = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', './extension/scripts/install-webstore-policy.ps1', '-ExtensionId', 'not-an-id', '-WhatIf'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
});
