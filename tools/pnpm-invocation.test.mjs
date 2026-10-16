import assert from 'node:assert/strict';
import test from 'node:test';

import { pnpmInvocation } from './pnpm-invocation.mjs';

const nodePath = '/usr/local/bin/node';

test('a JavaScript pnpm entry point runs through the current Node binary', () => {
  for (const entryPoint of ['/pnpm/bin/pnpm.cjs', '/pnpm/dist/pnpm.mjs', '/pnpm/bin/pnpm.js']) {
    assert.deepEqual(pnpmInvocation(entryPoint, ['run', 'ci:quality'], nodePath), {
      command: nodePath,
      args: [entryPoint, 'run', 'ci:quality'],
    });
  }
});

test('a native pnpm executable is spawned directly instead of being parsed by Node', () => {
  for (const entryPoint of [
    '/pnpm/node_modules/@pnpm/exe/pnpm',
    'C:\\pnpm\\node_modules\\@pnpm\\exe\\pnpm.exe',
  ]) {
    assert.deepEqual(pnpmInvocation(entryPoint, ['run', 'ci:database'], nodePath), {
      command: entryPoint,
      args: ['run', 'ci:database'],
    });
  }
});

test('a missing pnpm entry point is rejected with the existing guidance', () => {
  assert.throws(
    () => pnpmInvocation(undefined, ['run', 'ci:quality'], nodePath),
    /Run this command through pnpm so the pinned package manager can be reused\./,
  );
});
