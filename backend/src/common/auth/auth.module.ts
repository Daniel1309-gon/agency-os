import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '../../config/config.module.js';
import { IpAllowlistGuard, JwtAuthGuard, PermissionsGuard, RolesGuard } from './guards.js';
import { ClientCertGuard } from './client-cert.js';
import { AuthVersionService } from './auth-version.service.js';
import { ShiftWindowGuard } from './shift.guard.js';
import { SHIFT_ACCESS_CLOCK, ShiftAccessService, systemShiftAccessClock } from './shift-access.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    JwtAuthGuard,
    PermissionsGuard,
    IpAllowlistGuard,
    ClientCertGuard,
    AuthVersionService,
    ShiftAccessService,
    { provide: SHIFT_ACCESS_CLOCK, useValue: systemShiftAccessClock },
    ShiftWindowGuard,
    RolesGuard,
    { provide: APP_GUARD, useClass: ClientCertGuard },
    { provide: APP_GUARD, useClass: IpAllowlistGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ShiftWindowGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtAuthGuard, PermissionsGuard, AuthVersionService, ShiftAccessService, ShiftWindowGuard],
})
export class AuthCommonModule {}
