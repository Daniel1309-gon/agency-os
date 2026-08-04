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
    this.config = parsed.data;
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  get all(): Config {
    return this.config;
  }
}
