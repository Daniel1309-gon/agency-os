import { writeFile } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

Object.assign(process.env, {
  NODE_ENV: process.env.NODE_ENV ?? 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://agency:agency@localhost:5432/agency_os',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  JWT_SECRET: process.env.JWT_SECRET ?? 'openapi-generation-jwt-secret-at-least-32-characters',
  VAULT_KEK: process.env.VAULT_KEK ?? 'openapi-generation-vault-kek-at-least-32-characters',
});

const { AppModule } = await import('../dist/app.module.js');
const { buildOpenApiDocument, configureApiRouting, routePolicyMatrixMarkdown, stableOpenApiJson } = await import('../dist/openapi.js');
const app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { abortOnError: false, logger: false });

try {
  configureApiRouting(app);
  const document = buildOpenApiDocument(app);
  const target = new URL('../openapi.snapshot.json', import.meta.url);
  const matrixTarget = new URL('../../tasks/route-policy-matrix.md', import.meta.url);
  await writeFile(target, stableOpenApiJson(document), 'utf8');
  await writeFile(matrixTarget, routePolicyMatrixMarkdown(document), 'utf8');
  process.stdout.write(`Updated ${target.pathname} and ${matrixTarget.pathname}\n`);
} finally {
  await app.close();
}
