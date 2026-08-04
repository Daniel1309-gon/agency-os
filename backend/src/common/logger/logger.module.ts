import { Module, Global } from '@nestjs/common';
import { LoggerService } from './logger.service.js';
import { ConfigService } from '../../config/config.service.js';

@Global()
@Module({
  providers: [
    {
      provide: LoggerService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new LoggerService(config.get('LOG_LEVEL')),
    },
  ],
  exports: [LoggerService],
})
export class LoggerModule {}
