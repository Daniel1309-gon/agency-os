import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const helperDirectory = join(root, 'local-helper');
const workspaceCache = join(helperDirectory, '.go-cache');
mkdirSync(workspaceCache, { recursive: true });

const result = spawnSync(process.platform === 'win32' ? 'go.exe' : 'go', ['test', './...'], {
  cwd: helperDirectory,
  env: { ...process.env, GOCACHE: process.env.GOCACHE || workspaceCache },
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Native helper tests could not start: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
