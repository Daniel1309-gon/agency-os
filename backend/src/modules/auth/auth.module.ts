import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthCommonModule } from '../../common/auth/auth.module.js';

@Module({ imports: [AuthCommonModule], controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
