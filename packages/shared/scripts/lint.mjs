import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const violations = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.name.endsWith('.ts')) {
      const source = await readFile(path, 'utf8');
      if (/console\.log\s*\(/.test(source)) violations.push(`${path}: use the application logger instead of console.log`);
    }
  }
}

await visit(root);
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('shared lint checks passed');
}
