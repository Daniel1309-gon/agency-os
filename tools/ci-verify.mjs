import { spawnSync } from 'node:child_process';

const pnpmEntryPoint = process.env.npm_execpath;

if (!pnpmEntryPoint) {
  throw new Error('Run this command through pnpm so the pinned package manager can be reused.');
}

function run(script, extraEnv = {}) {
  const result = spawnSync(process.execPath, [pnpmEntryPoint, 'run', script], {
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
