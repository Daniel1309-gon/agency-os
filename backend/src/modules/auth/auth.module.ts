import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ShiftAccessService } from '../../common/auth/shift-access.service.js';

@Module({ controllers: [AuthController], providers: [AuthService, ShiftAccessService] })
export class AuthModule {}
