import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

const REDACT_PATHS = [
  'password',
  'password_hash',
  'secret',
  'secret_ciphertext',
  'secret_nonce',
  'secret_tag',
  'token',
  'authorization',
  'x-device-token',
  'credential',
  'credentialValue',
  'plaintext',
  'VAULT_KEK',
  'JWT_SECRET',
  '*.password',
  '*.password_hash',
  '*.secret',
  '*.secret_ciphertext',
  '*.token',
  '*.authorization',
  '*.credential',
];

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: Logger;

  constructor(level: string = 'info') {
    this.logger = pino({
      level,
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  fatal(msg: string, context?: Record<string, unknown>): void {
    this.logger.fatal(context ?? {}, msg);
  }
  error(msg: string, context?: Record<string, unknown>): void {
    this.logger.error(context ?? {}, msg);
  }
  warn(msg: string, context?: Record<string, unknown>): void {
    this.logger.warn(context ?? {}, msg);
  }
  log(msg: string, context?: Record<string, unknown>): void {
    this.logger.info(context ?? {}, msg);
  }
  info(msg: string, context?: Record<string, unknown>): void {
    this.logger.info(context ?? {}, msg);
  }
  debug(msg: string, context?: Record<string, unknown>): void {
    this.logger.debug(context ?? {}, msg);
  }
  verbose(msg: string, context?: Record<string, unknown>): void {
    this.logger.trace(context ?? {}, msg);
  }
}
