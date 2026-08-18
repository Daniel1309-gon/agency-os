import { Injectable } from '@nestjs/common';
import { configSchema, type Config } from './config.schema.js';

@Injectable()
export class ConfigService {
  private readonly config: Config;

  constructor() {
    const parsed = configSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    if (parsed.data.NODE_ENV === 'production') {
      const forbidden = ['change-me', 'changeme', 'minimum-secret', 'minimum-kek'];
      if (forbidden.some((part) => parsed.data.JWT_SECRET.toLowerCase().includes(part) || parsed.data.VAULT_KEK.toLowerCase().includes(part))) {
        throw new Error('Production secrets must not use placeholder values');
      }
      if (parsed.data.CORS_ORIGINS.includes('localhost')) throw new Error('Production CORS_ORIGINS cannot contain localhost');
      if (!parsed.data.DATABASE_APP_URL) {
        throw new Error('Production requires DATABASE_APP_URL for the least-privileged runtime role');
      }
      const migrationRole = new URL(parsed.data.DATABASE_URL).username;
      const runtimeRole = new URL(parsed.data.DATABASE_APP_URL).username;
      if (migrationRole === runtimeRole) {
        throw new Error('DATABASE_URL and DATABASE_APP_URL must use different PostgreSQL roles in production');
      }
      if (!parsed.data.ROCKETCHAT_BASE_URL || !parsed.data.ROCKETCHAT_TOKEN || !parsed.data.ROCKETCHAT_USER_ID) {
        throw new Error('Production requires ROCKETCHAT_BASE_URL, ROCKETCHAT_TOKEN and ROCKETCHAT_USER_ID');
      }
      if (parsed.data.ROCKETCHAT_WEBHOOK_SECRET.length < 32) {
        throw new Error('Production ROCKETCHAT_WEBHOOK_SECRET must contain at least 32 characters');
      }
    }
    this.config = parsed.data;
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  get all(): Config {
    return this.config;
  }
}
