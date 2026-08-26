import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../extension/chrome-extension/manifest.json', import.meta.url), 'utf8'));
const template = JSON.parse(await readFile(new URL('../extension/chrome-extension/manifest.template.json', import.meta.url), 'utf8'));
const EXPECTED_EXTENSION_ID = 'fcniigapdfcoigmnkhkcgmhlhjdledbo';

function extensionIdFromPublicKey(key) {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...digest].map((character) => {
    const code = character.charCodeAt(0);
    return String.fromCharCode(code >= 48 && code <= 57 ? code - 48 + 97 : code - 97 + 107);
  }).join('');
}

test('manual-install manifests keep the stable extension ID', () => {
  assert.equal(manifest.key, template.key);
  assert.match(manifest.key, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(extensionIdFromPublicKey(manifest.key), EXPECTED_EXTENSION_ID);
});
