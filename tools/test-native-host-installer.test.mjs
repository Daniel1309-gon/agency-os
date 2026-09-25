import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const installer = await readFile(new URL('../local-helper/scripts/install-native-host.ps1', import.meta.url), 'utf8');

test('Native Host installer fails closed before touching the registry', () => {
  assert.match(installer, /^\$ErrorActionPreference\s*=\s*['"]Stop['"]/m);
  assert.match(installer, /Test-Path\s+-LiteralPath\s+\$manifestPath\s+-PathType\s+Leaf/);

  const manifestWrite = installer.indexOf('Set-Content -LiteralPath $manifestPath');
  const registryWrite = installer.indexOf('New-Item -Path $registryPath');
  assert.ok(manifestWrite >= 0, 'the installer must write the manifest');
  assert.ok(registryWrite > manifestWrite, 'the registry must be written only after the manifest');
});
