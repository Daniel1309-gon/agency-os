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
  'deviceToken',
  'device_token',
  'enrollmentCode',
  'enrollment_code',
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
  '*.deviceToken',
  '*.device_token',
  '*.enrollmentCode',
  '*.enrollment_code',
  '*.authorization',
  '*.credential',
  '*.credentialValue',
  '*.plaintext',
  '**.password',
  '**.password_hash',
  '**.secret',
  '**.secret_ciphertext',
  '**.secret_nonce',
  '**.secret_tag',
  '**.token',
  '**.deviceToken',
  '**.device_token',
  '**.enrollmentCode',
  '**.enrollment_code',
  '**.authorization',
  '**.credential',
];

const SECRET_KEY = /^(password|password_hash|secret|secret_ciphertext|secret_nonce|secret_tag|token|deviceToken|device_token|enrollmentCode|enrollment_code|authorization|x-device-token|credential|credentialvalue|plaintext|vault_kek|jwt_secret)$/i;

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

  private safe(context: Record<string, unknown>): Record<string, unknown> {
    const scrub = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(scrub);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : scrub(item)]));
    };
    return scrub(context) as Record<string, unknown>;
  }

  fatal(msg: string, context?: Record<string, unknown>): void {
    this.logger.fatal(this.safe(context ?? {}), msg);
  }
  error(msg: string, context?: Record<string, unknown>): void {
    this.logger.error(this.safe(context ?? {}), msg);
  }
  warn(msg: string, context?: Record<string, unknown>): void {
    this.logger.warn(this.safe(context ?? {}), msg);
  }
  log(msg: string, context?: Record<string, unknown>): void {
    this.logger.info(this.safe(context ?? {}), msg);
  }
  info(msg: string, context?: Record<string, unknown>): void {
    this.logger.info(this.safe(context ?? {}), msg);
  }
  debug(msg: string, context?: Record<string, unknown>): void {
    this.logger.debug(this.safe(context ?? {}), msg);
  }
  verbose(msg: string, context?: Record<string, unknown>): void {
    this.logger.trace(this.safe(context ?? {}), msg);
  }
}
