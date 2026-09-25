import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AuthCommonModule } from './auth.module.js';
import { ShiftWindowGuard } from './shift.guard.js';
import { RolesGuard } from './guards.js';

describe('AuthCommonModule', () => {
  it('registers the shift window guard globally', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AuthCommonModule,
    ) as Array<{ provide?: unknown; useClass?: unknown }>;

    expect(providers).toContainEqual({
      provide: APP_GUARD,
      useClass: ShiftWindowGuard,
    });
    expect(providers).toContainEqual({
      provide: APP_GUARD,
      useClass: RolesGuard,
    });
  });
});
