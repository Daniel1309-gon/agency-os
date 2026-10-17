import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('local browser access is marked, HTTPS-only and reversible', async () => {
  const enable = await source('../deploy/station-e2e/enable-local-browser-access.ps1');
  const disable = await source('../deploy/station-e2e/disable-local-browser-access.ps1');
  for (const script of [enable, disable]) {
    assert.match(script, /BEGIN Agency OS Docker Host Browser/);
    assert.match(script, /END Agency OS Docker Host Browser/);
  }
  assert.match(enable, /Cert:\\LocalMachine\\Root/);
  assert.match(enable, /HasPrivateKey/);
  assert.match(enable, /CertificateAuthority/);
  assert.match(enable, /https:\/\/app\.agency-os\.test\//);
  assert.match(enable, /https:\/\/api\.agency-os\.test\/health\/ready/);
  assert.match(disable, /caWasAlreadyTrusted/);
  assert.doesNotMatch(disable, /Profile \*|User Data|down -v|--volumes/);
});
