import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '../../config/config.module.js';
import { IpAllowlistGuard, JwtAuthGuard, PermissionsGuard, RolesGuard } from './guards.js';
import { ShiftWindowGuard } from './shift.guard.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    JwtAuthGuard,
    PermissionsGuard,
    IpAllowlistGuard,
    ShiftWindowGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: IpAllowlistGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ShiftWindowGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtAuthGuard, PermissionsGuard, ShiftWindowGuard],
})
export class AuthCommonModule {}
