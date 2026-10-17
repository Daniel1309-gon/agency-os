import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function source(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('station E2E compose exposes only the TLS gateway and orders initialization', async () => {
  const compose = await source('../compose.station-e2e.yml');

  for (const service of ['postgres:', 'redis:', 'migrate:', 'bootstrap-app:', 'bootstrap-worker:', 'seed-base:', 'bootstrap-ip:', 'seed-demo:', 'api-a:', 'api-b:', 'gateway:']) {
    assert.match(compose, new RegExp(`^  ${service.replace(':', '\\:')}`, 'm'));
  }
  assert.match(compose, /published:\s*"443"/);
  assert.doesNotMatch(compose, /published:\s*"(?:5432|6379)"/);
  assert.match(compose, /condition:\s*service_healthy/);
  assert.match(compose, /condition:\s*service_completed_successfully/);
  assert.match(compose, /DATABASE_APP_URL_FILE:\s*\/run\/secrets\/database_app_url/);
  assert.match(compose, /DATABASE_WORKER_URL_FILE:\s*\/run\/secrets\/database_worker_url/);
  assert.match(compose, /rocketchat-worker:.*DATABASE_APP_URL_FILE:\s*""/s);
  assert.match(compose, /BOOTSTRAP_IP_CIDRS:\s*172\.30\.0\.1\/32,/);
  assert.match(compose, /gateway:\s*172\.30\.0\.1/);

  // The health routes sit outside the /api/v1 prefix; see route-contracts.ts.
  assert.match(compose, /127\.0\.0\.1:3000\/health\/ready/);
  assert.doesNotMatch(compose, /api\/v1\/health/);
});

test('every station E2E probe targets the unprefixed health route', async () => {
  for (const path of ['../.github/workflows/ci.yml', '../deploy/station-e2e/station/install.ps1']) {
    const probe = await source(path);
    assert.doesNotMatch(probe, /api\/v1\/health/, `${path} must not probe the /api/v1 health prefix`);
  }
});

test('API image is a frozen pnpm production deploy and runs without root', async () => {
  const dockerfile = await source('../backend/Dockerfile');
  assert.match(dockerfile, /FROM node:22-/);
  assert.match(dockerfile, /pnpm install --frozen-lockfile/);
  assert.match(dockerfile, /pnpm deploy --filter @agency-os\/api --prod --legacy/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/agency-os-entrypoint"\]/);

  // pnpm deploy falls back to .gitignore without an allowlist, and backend/.gitignore
  // excludes dist/, so the compiled output would never reach the runtime image.
  const manifest = JSON.parse(await source('../backend/package.json'));
  assert.ok(Array.isArray(manifest.files), 'backend/package.json must declare a files allowlist');
  assert.ok(manifest.files.includes('dist'), 'the deployed package must carry the compiled output');
  assert.ok(manifest.files.includes('scripts'), 'compose one-shot services run scripts/*.mjs');
  assert.ok(
    manifest.files.includes('src/database/migrations'),
    'scripts/db-migrate.mjs reads the migration folder at runtime',
  );
});

test('gateway serves the SPA and extension feed while proxying both APIs and WebSockets', async () => {
  const nginx = await source('../deploy/station-e2e/nginx.conf');
  assert.match(nginx, /server api-a:3000/);
  assert.match(nginx, /server api-b:3000/);
  assert.match(nginx, /server_name app\.agency-os\.test/);
  assert.match(nginx, /server_name api\.agency-os\.test/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html/);
  assert.match(nginx, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(nginx, /location \/extension\//);
});

test('operator commands validate, build, start, provision and stop without deleting volumes', async () => {
  const manifest = JSON.parse(await source('../package.json'));
  for (const script of ['stack:e2e:config', 'stack:e2e:build', 'stack:e2e:up', 'stack:e2e:provision', 'stack:e2e:down', 'station:bundle']) {
    assert.equal(typeof manifest.scripts[script], 'string', `${script} must be defined`);
  }
  assert.doesNotMatch(manifest.scripts['stack:e2e:down'], /(?:^|\s)-v(?:\s|$)|--volumes/);
});
