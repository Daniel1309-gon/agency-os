import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';
import { LoggerService } from './common/logger/logger.service.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';
import { RedisIoAdapter } from './modules/realtime/redis-io.adapter.js';
import { buildOpenApiDocument, configureApiRouting } from './openapi.js';
import { parseTrustedProxyCidrs } from './common/auth/ip.js';

async function bootstrap() {
  const bootstrapConfig = new ConfigService();
  const trustedProxyCidrs = parseTrustedProxyCidrs(bootstrapConfig.get('TRUSTED_PROXY_CIDRS'));
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, bodyLimit: 256 * 1024, trustProxy: trustedProxyCidrs.length ? trustedProxyCidrs : false }),
  );

  const config = app.get(ConfigService);
  const logger = app.get(LoggerService);

  const websocketAdapter = new RedisIoAdapter(app, config);
  await websocketAdapter.connect();
  app.useWebSocketAdapter(websocketAdapter);

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

  configureApiRouting(app);

  if (config.get('NODE_ENV') !== 'production') {
    const document = buildOpenApiDocument(app);
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
