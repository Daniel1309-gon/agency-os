import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://agency:agency@localhost:5432/agency_os',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'contract-test-jwt-secret-with-at-least-32-characters',
  VAULT_KEK: 'contract-test-vault-kek-with-at-least-32-characters',
});

const { AppModule } = await import('../dist/app.module.js');
const {
  buildOpenApiDocument,
  configureApiRouting,
  routePolicyMatrixMarkdown,
  stableOpenApiJson,
} = await import('../dist/openapi.js');
const {
  assertRouteContractCoverage,
  routeContracts,
} = await import('../dist/common/contracts/route-contracts.js');

let app;
let document;

before(async () => {
  app = await NestFactory.create(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { abortOnError: false, logger: false },
  );
  configureApiRouting(app);
  document = buildOpenApiDocument(app);
});

after(async () => {
  await app?.close();
});

test('catalogs every HTTP route with its complete policy dimensions', () => {
  assert.doesNotThrow(() => assertRouteContractCoverage(document, routeContracts));
});

test('rejects a new route that has no explicit contract entry', () => {
  const canaryDocument = structuredClone(document);
  canaryDocument.paths['/api/v1/canary'] = {
    get: { operationId: 'CanaryController.open', responses: {} },
  };

  assert.throws(
    () => assertRouteContractCoverage(canaryDocument, routeContracts),
    /GET \/api\/v1\/canary/,
  );
});

test('intersects class roles with method permissions when deriving effective actors', () => {
  const grantPolicy = document.paths['/api/v1/agent/session/credential-grant'].post['x-agency-policy'];
  const preparePolicy = document.paths['/api/v1/agent/sessions/prepare'].post['x-agency-policy'];

  assert.deepEqual(grantPolicy.actors, ['OPERADOR']);
  assert.deepEqual(grantPolicy.access.roles, ['OPERADOR']);
  assert.deepEqual(grantPolicy.access.permissions, ['vault.credential.issue']);
  assert.deepEqual(preparePolicy.actors, ['OPERADOR']);
});

test('models station-only routes without pretending they use an operator JWT', () => {
  const stationOperations = [
    document.paths['/api/v1/station/credential-claims'].post,
    document.paths['/api/v1/station/sessions/{id}'].patch,
  ];
  for (const stationOperation of stationOperations) {
    const stationPolicy = stationOperation['x-agency-policy'];
    assert.deepEqual(stationPolicy.actors, ['STATION']);
    assert.equal(stationPolicy.access.authenticated, false);
    assert.equal(stationPolicy.access.station, true);
    assert.deepEqual(stationOperation.security, [{ deviceToken: [] }]);
  }
});

test('rejects a station route that forgets the device guard', () => {
  const canaryDocument = structuredClone(document);
  delete canaryDocument.paths['/api/v1/station/credential-claims'].post['x-agency-device'];

  assert.throws(
    () => assertRouteContractCoverage(canaryDocument, routeContracts),
    /station route without device guard: POST \/api\/v1\/station\/credential-claims/,
  );
});

test('keeps public routes unauthenticated when controller metadata is inherited', () => {
  const loginPolicy = document.paths['/api/v1/auth/login'].post['x-agency-policy'];
  assert.equal(loginPolicy.access.public, true);
  assert.equal(loginPolicy.access.authenticated, false);
  assert.deepEqual(loginPolicy.actors, ['ANONYMOUS']);
});

test('publishes shared operator schemas and binds them to their HTTP operations', () => {
  const schemas = document.components.schemas;
  for (const name of [
    'AssignedProfile',
    'MetricBatchInput',
    'SessionCreateInput',
    'SessionPatchInput',
  ]) {
    assert.ok(schemas[name], `missing OpenAPI component ${name}`);
  }

  assert.equal(
    document.paths['/api/v1/agent/metrics/batch'].post.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/MetricBatchInput',
  );
  assert.equal(
    document.paths['/api/v1/agent/sessions'].post.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/SessionCreateInput',
  );
  assert.equal(
    document.paths['/api/v1/agent/sessions/{id}'].patch.requestBody.content['application/json'].schema.$ref,
    '#/components/schemas/SessionPatchInput',
  );
});

test('matches the reviewed deterministic OpenAPI snapshot', async () => {
  assert.equal(stableOpenApiJson(document), await readFile(new URL('../openapi.snapshot.json', import.meta.url), 'utf8'));
});

test('matches the human-readable route policy matrix', async () => {
  assert.equal(
    routePolicyMatrixMarkdown(document),
    await readFile(new URL('../../tasks/route-policy-matrix.md', import.meta.url), 'utf8'),
  );
});
