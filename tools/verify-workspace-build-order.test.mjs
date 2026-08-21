import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('isolated API gates build the complete workspace dependency closure', async () => {
  const [rootPackage, backendPackage, workflow] = await Promise.all([
    readJson('package.json'),
    readJson('backend/package.json'),
    readFile(new URL('.github/workflows/ci.yml', root), 'utf8'),
  ]);

  assert.equal(backendPackage.dependencies['@agency-os/shared'], 'workspace:*');
  assert.match(backendPackage.scripts['test:integration'], /--filter @agency-os\/api\.\.\. build/);
  assert.match(rootPackage.scripts['ci:database'], /--filter @agency-os\/api\.\.\. build/);
  assert.match(workflow, /Build backend for database commands\s+run: pnpm --filter @agency-os\/api\.\.\. build/);
});
