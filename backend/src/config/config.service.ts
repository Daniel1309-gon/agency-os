import { Injectable } from '@nestjs/common';
import { configSchema, type Config } from './config.schema.js';
import { parseTrustedProxyCidrs } from '../common/auth/ip.js';

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
    const trustedProxyCidrs = parseTrustedProxyCidrs(parsed.data.TRUSTED_PROXY_CIDRS);
    const runtimeUrlByRole = {
      app: parsed.data.DATABASE_APP_URL,
      worker: parsed.data.DATABASE_WORKER_URL,
      readonly: parsed.data.DATABASE_READONLY_URL,
    } as const;
    const runtimeUrl = runtimeUrlByRole[parsed.data.DATABASE_RUNTIME_ROLE];
    const runtimeVariable = `DATABASE_${parsed.data.DATABASE_RUNTIME_ROLE.toUpperCase()}_URL`;
    if (parsed.data.DATABASE_RUNTIME_ROLE !== 'app' && !runtimeUrl) {
      throw new Error(`${runtimeVariable} is required when DATABASE_RUNTIME_ROLE is ${parsed.data.DATABASE_RUNTIME_ROLE}`);
    }
    if (parsed.data.NODE_ENV === 'production') {
      const forbidden = ['change-me', 'changeme', 'minimum-secret', 'minimum-kek'];
      if (forbidden.some((part) => parsed.data.JWT_SECRET.toLowerCase().includes(part) || parsed.data.VAULT_KEK.toLowerCase().includes(part))) {
        throw new Error('Production secrets must not use placeholder values');
      }
      if (parsed.data.CORS_ORIGINS.includes('localhost')) throw new Error('Production CORS_ORIGINS cannot contain localhost');
      if (!trustedProxyCidrs.length) throw new Error('Production requires TRUSTED_PROXY_CIDRS');
      if (!runtimeUrl) throw new Error(`Production requires ${runtimeVariable} for the least-privileged runtime role`);
      const migrationRole = new URL(parsed.data.DATABASE_URL).username;
      const runtimeRole = new URL(runtimeUrl).username;
      if (migrationRole === runtimeRole) {
        throw new Error(`${runtimeVariable} and DATABASE_URL must use different PostgreSQL roles in production`);
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
