import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '../../config/config.module.js';
import { IpAllowlistGuard, JwtAuthGuard, PermissionsGuard, RolesGuard } from './guards.js';
import { ShiftWindowGuard } from './shift.guard.js';
import { SHIFT_ACCESS_CLOCK, ShiftAccessService, systemShiftAccessClock } from './shift-access.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    JwtAuthGuard,
    PermissionsGuard,
    IpAllowlistGuard,
    ShiftAccessService,
    { provide: SHIFT_ACCESS_CLOCK, useValue: systemShiftAccessClock },
    ShiftWindowGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: IpAllowlistGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ShiftWindowGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtAuthGuard, PermissionsGuard, ShiftAccessService, ShiftWindowGuard],
})
export class AuthCommonModule {}
