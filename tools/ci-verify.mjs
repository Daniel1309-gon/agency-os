import { spawnSync } from 'node:child_process';

import { pnpmInvocation } from './pnpm-invocation.mjs';

const pnpmEntryPoint = process.env.npm_execpath;

function run(script, extraEnv = {}) {
  const { command, args } = pnpmInvocation(pnpmEntryPoint, ['run', script]);
  const result = spawnSync(command, args, {
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('ci:quality');
run('ci:database', {
  NODE_ENV: 'test',
  TEST_DB_RECREATE: '1',
});
