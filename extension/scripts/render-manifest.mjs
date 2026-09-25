import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const templatePath = join(root, 'chrome-extension', 'manifest.template.json');
const outputPath = join(root, 'chrome-extension', 'manifest.json');
const webOrigin = process.env.AGENCY_OS_WEB_APP_ORIGIN || 'https://app.agency-os.example';
const apiOrigin = process.env.AGENCY_OS_API_ORIGIN || 'https://api.agency-os.example';

function exactOrigin(value, name) {
  const parsed = new URL(value);
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.hostname.includes('*')) {
    throw new Error(`${name} must be an exact HTTP(S) origin without a path or wildcard`);
  }
  if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost') throw new Error(`${name} must use HTTPS outside localhost`);
  return parsed.origin;
}

const template = await readFile(templatePath, 'utf8');
const manifest = template
  .replaceAll('__WEB_APP_ORIGIN__', exactOrigin(webOrigin, 'AGENCY_OS_WEB_APP_ORIGIN'))
  .replaceAll('__API_ORIGIN__', exactOrigin(apiOrigin, 'AGENCY_OS_API_ORIGIN'));
await writeFile(outputPath, `${manifest.trim()}\n`, 'utf8');
console.log(`manifest rendered for ${webOrigin} and ${apiOrigin}`);
