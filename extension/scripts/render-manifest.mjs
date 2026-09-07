import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const templatePath = join(root, 'chrome-extension', 'manifest.template.json');
const outputPath = join(root, 'chrome-extension', 'manifest.json');

function exactOrigin(value, name) {
  const parsed = new URL(value);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.hostname.includes('*')) {
    throw new Error(`${name} must be an exact HTTP(S) origin without a path or wildcard`);
  }
  if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost') throw new Error(`${name} must use HTTPS outside localhost`);
  return parsed.origin;
}

export async function renderManifest(webOrigin, apiOrigin) {
  const template = await readFile(templatePath, 'utf8');
  return JSON.parse(template
    .replaceAll('__WEB_APP_ORIGIN__', exactOrigin(webOrigin, 'AGENCY_OS_WEB_APP_ORIGIN'))
    .replaceAll('__API_ORIGIN__', exactOrigin(apiOrigin, 'AGENCY_OS_API_ORIGIN')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const webOrigin = process.env.AGENCY_OS_WEB_APP_ORIGIN || 'https://app.agency-os.example';
  const apiOrigin = process.env.AGENCY_OS_API_ORIGIN || 'https://api.agency-os.example';
  const manifest = await renderManifest(webOrigin, apiOrigin);
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`manifest rendered for ${webOrigin} and ${apiOrigin}`);
}
