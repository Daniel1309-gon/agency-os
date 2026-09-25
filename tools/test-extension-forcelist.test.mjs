import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const packager = await readFile(new URL('../extension/empaquetar_y_probar_forcelist.py', import.meta.url), 'utf8');

test('ExtensionInstallForcelist writes numbered values directly on the policy key', () => {
  assert.match(packager, /winreg\.SetValueEx\(\s*clave,\s*['"]1['"],\s*0,\s*winreg\.REG_SZ,\s*valor\s*\)/s);
  assert.doesNotMatch(packager, /winreg\.CreateKey\(\s*clave,\s*['"]1['"]\s*\)/s);
});

test('the real-machine policy spike targets HKLM for an elevated office-PC install', () => {
  assert.match(packager, /winreg\.HKEY_LOCAL_MACHINE/);
  assert.doesNotMatch(packager, /winreg\.HKEY_CURRENT_USER/);
});
