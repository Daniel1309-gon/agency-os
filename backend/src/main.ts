import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';
import { LoggerService } from './common/logger/logger.service.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 256 * 1024 }),
  );

  const config = app.get(ConfigService);
  const logger = app.get(LoggerService);

  app.useLogger(logger);

  if (config.get('NODE_ENV') === 'production') {
    await app.register(helmet as never);
  } else {
    await app.register(helmet as never, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'validator.swagger.io'],
          scriptSrc: ["'self'", 'https:', "'unsafe-inline'"],
        },
      },
    } as never);
  }
  const allowedOrigins = config.get('CORS_ORIGINS').split(',').map((s: string) => s.trim()).filter(Boolean);
  const extensionId = config.get('EXTENSION_ID');
  if (extensionId) allowedOrigins.push(`chrome-extension://${extensionId}`);
  await app.register(cors as never, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  // Rutas exactas, no wildcard: la sintaxis de patrones de exclusion de Nest
  // ha cambiado entre versiones mayores (path-to-regexp), y solo hay dos
  // rutas de salud que agregar aqui si llega a haber una tercera.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  if (config.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Agency OS API')
      .setDescription('API operacional de Agency OS')
      .setVersion('1.0.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'accessToken',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    const publicOperations = new Set([
      'GET /health/live',
      'GET /health/ready',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/refresh',
      'POST /api/v1/devices/enroll',
    ]);
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;
    type DocumentedOperation = { security?: Array<Record<string, string[]>> };
    type DocumentedPathItem = Partial<Record<(typeof methods)[number], DocumentedOperation>>;
    const pathItems = document.paths as Record<string, DocumentedPathItem>;
    for (const [path, pathItem] of Object.entries(pathItems)) {
      for (const method of methods) {
        const operation = pathItem[method];
        if (operation && !publicOperations.has(`${method.toUpperCase()} ${path}`)) {
          operation.security = [{ accessToken: [] }];
        }
      }
    }
    SwaggerModule.setup('docs', app, document, {
      useGlobalPrefix: false,
      jsonDocumentUrl: 'docs-json',
      customSiteTitle: 'Agency OS API Docs',
    });
  }

  app.useGlobalFilters(new GlobalExceptionFilter(logger));

  const port = config.get('PORT');
  await app.listen(port as unknown as string, '0.0.0.0');
  logger.info('Agency OS API listening', { port });
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
