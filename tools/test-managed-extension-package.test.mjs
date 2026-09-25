import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { extensionIdFromManifestKey, renderUpdateXml } from '../extension/scripts/package-managed-extension.mjs';

test('stable manifest public key derives the documented Chrome extension id', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/chrome-extension/manifest.template.json', import.meta.url), 'utf8'));
  assert.equal(extensionIdFromManifestKey(manifest.key), 'fcniigapdfcoigmnkhkcgmhlhjdledbo');
});

test('managed update feed is HTTPS and contains only the expected app and CRX', () => {
  const xml = renderUpdateXml('fcniigapdfcoigmnkhkcgmhlhjdledbo', '1.0.0');
  assert.match(xml, /appid="fcniigapdfcoigmnkhkcgmhlhjdledbo"/);
  assert.match(xml, /codebase="https:\/\/app\.agency-os\.test\/extension\/agency-os\.crx"/);
  assert.doesNotMatch(xml, /localhost|codebase="http:/);
});
