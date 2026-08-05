import { Injectable } from '@nestjs/common';
import { configSchema, type Config } from '@agency-os/shared';

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
