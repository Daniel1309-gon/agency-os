import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = join(root, 'chrome-extension', 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const background = await readFile(join(root, 'chrome-extension', 'background.js'), 'utf8');
const content = await readFile(join(root, 'chrome-extension', 'content.js'), 'utf8');
const failures = [];

if (manifest.manifest_version !== 3) failures.push('manifest_version must be 3');
if (!manifest.background?.service_worker) failures.push('background.service_worker is required');
if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) {
  failures.push('at least one content script is required');
}
if (manifest.host_permissions?.some((permission) => permission.startsWith('file:'))) failures.push('file:// host permission is forbidden');
if (!manifest.permissions?.includes('storage')) failures.push('storage permission is required');
if (!manifest.externally_connectable?.matches?.length) failures.push('externally_connectable is required');
if (!manifest.storage?.managed_schema) failures.push('managed storage schema is required');
if (/credenciales\.json|file:\/\//i.test(`${background}\n${content}`)) failures.push('local credential files are forbidden');
for (const endpoint of ['/agent/sessions/', '/agent/session/credential-grant', '/agent/session/credential-redeem']) {
  if (!background.includes(endpoint)) failures.push(`background.js must call ${endpoint}`);
}

for (const file of ['background.js', 'content.js']) {
  const result = spawnSync(process.execPath, ['--check', join(root, 'chrome-extension', file)], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${file}: ${result.stderr.trim()}`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`extension checks passed (${manifest.name} ${manifest.version})`);
}
