import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderManifest } from './render-manifest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const source = join(root, 'extension', 'chrome-extension');

export async function webStoreManifest(webOrigin, apiOrigin) {
  const manifest = await renderManifest(webOrigin, apiOrigin);
  // Google assigns the store item ID. Keep the unpacked development key out of this ZIP.
  delete manifest.key;
  const local = [webOrigin, apiOrigin].some((origin) => new URL(origin).hostname === 'localhost');
  if (local) manifest.name += ' BETA';
  manifest.description = 'Prepara el acceso a perfiles asignados de TalkyTimes desde Agency OS. Requiere una estación configurada.';
  manifest.icons = { 128: 'icon128.png' };
  return manifest;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Este empaquetador usa ZipFile de .NET mediante Windows PowerShell.');
  if (process.argv.slice(2).some((arg) => arg !== '--local')) throw new Error('Única opción: --local. Para HTTPS, use AGENCY_OS_WEB_APP_ORIGIN y AGENCY_OS_API_ORIGIN.');
  const local = process.argv.includes('--local');
  const webOrigin = local ? 'http://localhost:5173' : process.env.AGENCY_OS_WEB_APP_ORIGIN;
  const apiOrigin = local ? 'http://localhost:3000' : process.env.AGENCY_OS_API_ORIGIN;
  const manifest = await webStoreManifest(webOrigin, apiOrigin);
  const output = join(root, '.local', 'chrome-web-store');
  await mkdir(output, { recursive: true });
  const build = await mkdtemp(join(output, 'build-'));
  const stage = join(build, 'extension');
  await mkdir(stage);
  // Allowlist: never copy an entire extension directory containing spike files or secrets.
  for (const file of ['background.js', 'content.js', 'managed_schema.json', 'icon128.png']) {
    await copyFile(join(source, file), join(stage, file));
  }
  await writeFile(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const zip = join(build, `agency-os-${manifest.version}.zip`);
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${quote(stage)}, ${quote(zip)})`
  ], { stdio: 'pipe' });
  const sha256 = createHash('sha256').update(await readFile(zip)).digest('hex');
  const result = { zip, sha256, version: manifest.version, webOrigin, apiOrigin, distribution: 'Chrome Web Store (draft, not published)' };
  await writeFile(join(build, 'artifact.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
