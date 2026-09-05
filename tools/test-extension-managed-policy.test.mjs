import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const installer = await readFile(new URL('../extension/scripts/install-managed-policy.ps1', import.meta.url), 'utf8');

test('managed extension policy is machine-scoped and requires an extension id', () => {
  assert.match(installer, /HKLM:\\Software\\Policies\\Google\\Chrome\\3rdparty\\Extensions/);
  assert.match(installer, /ValidatePattern\(\s*['"]\^\[a-p\]\{32\}\$['"]\s*\)/);
  assert.match(installer, /IsUserAnAdmin|WindowsPrincipal/);
});

test('managed policy reads the device token from a file and provisions the four runtime values', () => {
  assert.match(installer, /DeviceTokenFile/);
  assert.match(installer, /Get-Content[^\r\n]*-Raw/);
  for (const property of ['apiBaseUrl', 'webAppOrigin', 'deviceToken', 'nativeHostName']) {
    assert.match(installer, new RegExp(`['"]${property}['"]`));
  }
  assert.doesNotMatch(installer, /Write-Output\s+\$deviceToken|Write-Host\s+\$deviceToken/);
});
