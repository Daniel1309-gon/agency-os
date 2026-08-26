import { RequestMethod } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  assignedProfileSchema,
  cafeteriaOrderSchema,
  cafeteriaProductSchema,
  errorEnvelopeSchema,
  launchProfileMessageSchema,
  metricBatchSchema,
  operationalMetricsSchema,
  paginationSchema,
  prepareSessionMessageSchema,
  sessionCloseSchema,
  sessionCreateSchema,
  sessionPatchSchema,
  userSummarySchema,
} from '@agency-os/shared';
import {
  applyRouteContracts,
  routeContracts,
  type EffectiveRoutePolicy,
} from './common/contracts/route-contracts.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;

extendZodWithOpenApi(z);

export function configureApiRouting(app: NestFastifyApplication): void {
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
}

export function buildOpenApiDocument(app: NestFastifyApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Agency OS API')
    .setDescription('API operacional de Agency OS')
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'accessToken',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-device-token' },
      'deviceToken',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey}.${methodKey}`,
  });
  attachSharedSchemas(document);
  applyRouteContracts(document, routeContracts);
  return document;
}

function operationAt(document: OpenAPIObject, path: string, method: 'get' | 'patch' | 'post'): Record<string, unknown> {
  const operation = document.paths[path]?.[method] as Record<string, unknown> | undefined;
  if (!operation) throw new Error(`OpenAPI operation not found: ${method.toUpperCase()} ${path}`);
  return operation;
}

function setRequestSchema(document: OpenAPIObject, path: string, method: 'patch' | 'post', schema: string): void {
  operationAt(document, path, method).requestBody = {
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
  };
}

function setResponseSchema(document: OpenAPIObject, path: string, method: 'get', schema: string): void {
  operationAt(document, path, method).responses = {
    200: {
      description: 'Successful response',
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
    },
  };
}

function attachSharedSchemas(document: OpenAPIObject): void {
  const registry = new OpenAPIRegistry();
  const assignedProfile = registry.register('AssignedProfile', assignedProfileSchema);
  const cafeteriaOrder = registry.register('CafeteriaOrder', cafeteriaOrderSchema);
  const cafeteriaProduct = registry.register('CafeteriaProduct', cafeteriaProductSchema);
  registry.register('AssignedProfileList', z.array(assignedProfile));
  registry.register('CafeteriaOrderList', z.array(cafeteriaOrder));
  registry.register('CafeteriaProductList', z.array(cafeteriaProduct));
  registry.register('ErrorEnvelope', errorEnvelopeSchema);
  registry.register('LaunchProfileMessage', launchProfileMessageSchema);
  registry.register('MetricBatchInput', metricBatchSchema);
  registry.register('OperationalMetrics', operationalMetricsSchema);
  registry.register('Pagination', paginationSchema);
  registry.register('PrepareSessionMessage', prepareSessionMessageSchema);
  registry.register('SessionCreateInput', sessionCreateSchema);
  registry.register('SessionCloseInput', sessionCloseSchema);
  registry.register('SessionPatchInput', sessionPatchSchema);
  registry.register('UserSummary', userSummarySchema);

  const generated = new OpenApiGeneratorV3(registry.definitions).generateComponents();
  type NestSchemas = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>;
  const generatedSchemas = (generated.components?.schemas ?? {}) as unknown as NestSchemas;
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ...generatedSchemas,
    },
  };

  setRequestSchema(document, '/api/v1/agent/metrics/batch', 'post', 'MetricBatchInput');
  setRequestSchema(document, '/api/v1/agent/sessions/prepare', 'post', 'SessionCreateInput');
  setRequestSchema(document, '/api/v1/agent/sessions', 'post', 'SessionCreateInput');
  setRequestSchema(document, '/api/v1/agent/sessions/{id}', 'patch', 'SessionPatchInput');
  setRequestSchema(document, '/api/v1/agent/sessions/{id}/close', 'post', 'SessionCloseInput');
  setResponseSchema(document, '/api/v1/agent/profiles/assigned', 'get', 'AssignedProfileList');
  setResponseSchema(document, '/api/v1/metrics/operations', 'get', 'OperationalMetrics');
  setResponseSchema(document, '/api/v1/cafeteria/menu', 'get', 'CafeteriaProductList');
  setResponseSchema(document, '/api/v1/cafeteria/products', 'get', 'CafeteriaProductList');
  setResponseSchema(document, '/api/v1/cafeteria/orders', 'get', 'CafeteriaOrderList');
  setResponseSchema(document, '/api/v1/auth/me', 'get', 'UserSummary');
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObject(entry)]),
  );
}

export function stableOpenApiJson(document: OpenAPIObject): string {
  return `${JSON.stringify(sortObject(document), null, 2)}\n`;
}

export function routePolicyMatrixMarkdown(document: OpenAPIObject): string {
  const policies: EffectiveRoutePolicy[] = [];
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem?.[method] as ({ 'x-agency-policy'?: EffectiveRoutePolicy }) | undefined;
      if (!operation) continue;
      const policy = operation['x-agency-policy'];
      if (!policy) throw new Error(`OpenAPI operation ${method.toUpperCase()} is missing x-agency-policy`);
      policies.push(policy);
    }
  }
  policies.sort((left, right) => `${left.path} ${left.method}`.localeCompare(`${right.path} ${right.method}`));

  const lines = [
    '# Matriz ruta × política',
    '',
    'Generada desde los decoradores Nest y `backend/src/common/contracts/route-contracts.ts`.',
    'Describe la implementación actual; los actores pendientes de OQ-01/OQ-02 no constituyen aprobación del cliente.',
    '`UNBOUNDED` identifica deuda explícita que los slices funcionales deberán reemplazar por un límite verificable.',
    '',
    '| Ruta | Actores efectivos | Acceso | Device | Shift | Scope | Idempotencia | Paginación |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const policy of policies) {
    const access = policy.access.public
      ? 'public'
      : policy.access.station
        ? 'station'
      : [
        'authenticated',
        policy.access.roles.length ? `roles: ${policy.access.roles.join(', ')}` : '',
        policy.access.permissions.length ? `permissions: ${policy.access.permissions.join(', ')}` : '',
      ].filter(Boolean).join('; ');
    lines.push(
      `| \`${policy.method} ${policy.path}\` | ${policy.actors.join(', ')} | ${access} | ${policy.device ? 'REQUIRED' : 'NOT_REQUIRED'} | ${policy.shift ? 'REQUIRED' : 'NOT_REQUIRED'} | ${policy.scope} | ${policy.idempotency} | ${policy.pagination} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
