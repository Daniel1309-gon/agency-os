import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(extensionRoot, '..');

function chromeIdFromDer(der) {
  return createHash('sha256').update(der).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (character) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(character, 16)));
}

export function extensionIdFromManifestKey(manifestKey) {
  if (typeof manifestKey !== 'string' || !manifestKey) throw new Error('manifest.key is required');
  return chromeIdFromDer(Buffer.from(manifestKey, 'base64'));
}

export function renderUpdateXml(extensionId, version) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid Chrome extension id');
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('Invalid Chrome extension version');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${extensionId}">
    <updatecheck codebase="https://app.agency-os.test/extension/agency-os.crx" version="${version}" />
  </app>
</gupdate>
`;
}

async function existingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep looking through known Chrome locations.
    }
  }
  return '';
}

async function main() {
  const expectedId = process.env.EXTENSION_ID?.trim();
  const viteId = process.env.VITE_EXTENSION_ID?.trim();
  if (!expectedId || !viteId) throw new Error('EXTENSION_ID and VITE_EXTENSION_ID are required');
  if (expectedId !== viteId) throw new Error('EXTENSION_ID and VITE_EXTENSION_ID must match');

  const source = join(extensionRoot, 'chrome-extension');
  const pemPath = resolve(projectRoot, process.env.EXTENSION_PEM_FILE || 'extension/chrome-extension.pem');
  const localRoot = resolve(projectRoot, process.env.STATION_E2E_LOCAL_DIR || '.local/station-e2e');
  const stage = join(localRoot, 'chrome-extension-managed');
  const generatedCrx = `${stage}.crx`;
  const output = join(localRoot, 'extension-public');
  const outputCrx = join(output, 'agency-os.crx');

  const [templateRaw, privatePem] = await Promise.all([
    readFile(join(source, 'manifest.template.json'), 'utf8'),
    readFile(pemPath),
  ]);
  const template = JSON.parse(templateRaw);
  const manifestId = extensionIdFromManifestKey(template.key);
  const privateId = chromeIdFromDer(createPublicKey(createPrivateKey(privatePem)).export({ type: 'spki', format: 'der' }));
  if (manifestId !== privateId || manifestId !== expectedId) {
    throw new Error(`Extension identity mismatch: manifest=${manifestId}, pem=${privateId}, configured=${expectedId}`);
  }

  await rm(stage, { recursive: true, force: true });
  await rm(generatedCrx, { force: true });
  await mkdir(stage, { recursive: true });
  for (const name of ['background.js', 'content.js', 'managed_schema.json']) {
    await cp(join(source, name), join(stage, name));
  }
  const rendered = JSON.stringify({
    ...template,
    host_permissions: template.host_permissions.map((value) => value.replace('__API_ORIGIN__', 'https://api.agency-os.test')),
    externally_connectable: {
      ...template.externally_connectable,
      matches: template.externally_connectable.matches.map((value) => value.replace('__WEB_APP_ORIGIN__', 'https://app.agency-os.test')),
    },
  }, null, 2);
  await writeFile(join(stage, 'manifest.json'), `${rendered}\n`, 'utf8');

  const chrome = process.env.CHROME_PATH || await existingPath([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]);
  if (!chrome) throw new Error('Chrome was not found; set CHROME_PATH');
  const packed = spawnSync(chrome, [`--pack-extension=${stage}`, `--pack-extension-key=${pemPath}`], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
  if (packed.error || packed.status !== 0) throw new Error('Chrome could not package the managed extension');
  await access(generatedCrx, fsConstants.R_OK);
  await mkdir(output, { recursive: true });
  await rm(outputCrx, { force: true });
  await rename(generatedCrx, outputCrx);
  await writeFile(join(output, 'update.xml'), renderUpdateXml(expectedId, template.version), 'utf8');
  console.log(`Managed CRX packaged for extension ${expectedId}; private signing key was not copied`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
