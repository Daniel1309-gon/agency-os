import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '../../config/config.module.js';
import { IpAllowlistGuard, JwtAuthGuard, PermissionsGuard } from './guards.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    JwtAuthGuard,
    PermissionsGuard,
    IpAllowlistGuard,
    { provide: APP_GUARD, useClass: IpAllowlistGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [JwtAuthGuard, PermissionsGuard],
})
export class AuthCommonModule {}
