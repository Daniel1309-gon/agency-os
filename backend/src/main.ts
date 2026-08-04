import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
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

  await app.register(helmet as never);
  await app.register(cors as never, {
    origin: config.get('CORS_ORIGINS').split(',').map((s: string) => s.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', { exclude: ['/health'] });
  app.useGlobalFilters(new GlobalExceptionFilter(logger));

  const port = config.get('PORT');
  await app.listen(port as unknown as string, '0.0.0.0');
  logger.info('Agency OS API listening', { port });
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
