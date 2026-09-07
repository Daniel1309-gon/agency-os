import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { webStoreManifest } from '../extension/scripts/package-webstore.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('store manifest scopes origins, drops the development key and labels localhost as beta', async () => {
  const manifest = await webStoreManifest('http://localhost:5173', 'http://localhost:3000');
  assert.equal(manifest.key, undefined);
  assert.equal(manifest.update_url, undefined);
  assert.match(manifest.name, /BETA/);
  assert.deepEqual(manifest.externally_connectable.matches, ['http://localhost:5173/*']);
  assert.deepEqual(manifest.host_permissions, ['https://talkytimes.com/*', 'http://localhost:3000/*']);
  assert.deepEqual(manifest.permissions, ['storage', 'nativeMessaging']);
  assert.ok(manifest.description.length <= 132);
  for (const origin of ['http://example.com', 'https://*.example.com', 'https://example.com/path', 'https://u:p@example.com', 'file:///tmp']) {
    await assert.rejects(webStoreManifest(origin, 'http://localhost:3000'));
    await assert.rejects(webStoreManifest('http://localhost:5173', origin));
  }
  const production = await webStoreManifest('https://app.example.com', 'https://api.example.com');
  assert.doesNotMatch(production.name, /BETA/);
  assert.deepEqual(production.externally_connectable.matches, ['https://app.example.com/*']);
});

test('Windows ZIP contains only runtime assets with its manifest at the root and leaves development unchanged', { skip: process.platform !== 'win32' }, async () => {
  const devPath = new URL('../extension/chrome-extension/manifest.json', import.meta.url);
  const before = await readFile(devPath);
  const result = JSON.parse(execFileSync(process.execPath, ['extension/scripts/package-webstore.mjs', '--local'], { cwd: root, encoding: 'utf8' }));
  const zip = await readFile(result.zip);
  assert.equal(createHash('sha256').update(zip).digest('hex'), result.sha256);
  const quotedZip = "'" + result.zip.replaceAll("'", "''") + "'";
  const entries = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead(${quotedZip})
    try {
      $names = @($archive.Entries | ForEach-Object { $_.FullName })
      $reader = [IO.StreamReader]::new($archive.GetEntry('manifest.json').Open())
      try { @{ names = $names; manifest = ($reader.ReadToEnd() | ConvertFrom-Json) } | ConvertTo-Json -Depth 8 -Compress } finally { $reader.Dispose() }
    } finally { $archive.Dispose() }
  `], { encoding: 'utf8' }));
  assert.deepEqual(entries.names.sort(), ['background.js', 'content.js', 'icon128.png', 'managed_schema.json', 'manifest.json']);
  assert.equal(entries.manifest.key, undefined);
  assert.equal(entries.manifest.icons['128'], 'icon128.png');
  assert.deepEqual(await readFile(devPath), before);
  const icon = await readFile(new URL('../extension/chrome-extension/icon128.png', import.meta.url));
  assert.equal(icon.subarray(1, 4).toString(), 'PNG');
  assert.equal(icon.readUInt32BE(16), 128);
  assert.equal(icon.readUInt32BE(20), 128);
});
