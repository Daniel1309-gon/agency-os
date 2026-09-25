import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { LoggerService } from './common/logger/logger.service.js';

/**
 * Worker entrypoint. It creates an application context without opening an
 * HTTP listener; CommunicationWorker starts only with DATABASE_RUNTIME_ROLE=worker.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const logger = app.get(LoggerService);
  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Agency OS worker stopping', { signal });
    await app.close();
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  logger.info('Agency OS worker started');
}

bootstrap().catch((error) => {
  console.error('Fatal worker bootstrap error:', error);
  process.exit(1);
});
