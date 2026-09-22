import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const installer = await readFile(new URL('../extension/scripts/install-managed-policy.ps1', import.meta.url), 'utf8');
const schema = await readFile(new URL('../extension/chrome-extension/managed_schema.json', import.meta.url), 'utf8');

test('managed extension policy is machine-scoped and requires an extension id', () => {
  assert.match(installer, /HKLM:\\Software\\Policies\\Google\\Chrome\\3rdparty\\Extensions/);
  assert.match(installer, /ValidatePattern\(\s*['"]\^\[a-p\]\{32\}\$['"]\s*\)/);
  assert.match(installer, /IsUserAnAdmin|WindowsPrincipal/);
});

test('managed policy provisions the three runtime values and never a device secret', () => {
  for (const property of ['apiBaseUrl', 'webAppOrigin', 'nativeHostName']) {
    assert.match(installer, new RegExp(`['"]${property}['"]`));
  }
  assert.doesNotMatch(installer, /DeviceTokenFile|deviceToken|device-token/);
  assert.doesNotMatch(schema, /deviceToken|device-token/);
});
