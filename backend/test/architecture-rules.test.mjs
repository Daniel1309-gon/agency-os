import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeTypeScriptSource } from '../scripts/architecture-rules.mjs';

function rulesFor(filePath, source) {
  return analyzeTypeScriptSource(filePath, source).map((violation) => violation.rule);
}

test('rejects schema imports from application services', () => {
  const rules = rulesFor(
    'src/modules/vault/vault.service.ts',
    "import { users } from '../../database/schema/index.js';",
  );

  assert.deepEqual(rules, ['module-no-direct-schema']);
});

test('allows schema imports inside a domain-specific repository adapter', () => {
  const rules = rulesFor(
    'src/modules/vault/vault.drizzle-repository.ts',
    "import { users } from '../../database/schema/index.js';",
  );

  assert.deepEqual(rules, []);
});

test('rejects private imports across module boundaries', () => {
  const rules = rulesFor(
    'src/modules/assignments/assignments.service.ts',
    "import { ProfilesService } from '../profiles/profiles.service.js';",
  );

  assert.deepEqual(rules, ['module-no-private-cross-import']);
});

test('allows another module public Nest module', () => {
  const rules = rulesFor(
    'src/modules/assignments/assignments.module.ts',
    "import { ProfilesModule } from '../profiles/profiles.module.js';",
  );

  assert.deepEqual(rules, []);
});

test('detects executable forbidden calls without matching comments or strings', () => {
  const safe = rulesFor(
    'src/common/example.ts',
    "const description = 'console.log and sql.raw are forbidden'; // console.log('not executable')",
  );
  const unsafe = rulesFor(
    'src/common/example.ts',
    "console.log('leak'); sql.raw('select 1');",
  );

  assert.deepEqual(safe, []);
  assert.deepEqual(unsafe, ['no-console-log', 'no-sql-raw']);
});

test('detects SELECT star only in executable string literals', () => {
  const rules = rulesFor(
    'src/common/example.ts',
    "const query = 'SELECT * FROM users'; // SELECT * in a comment is harmless",
  );

  assert.deepEqual(rules, ['no-select-star']);
});
