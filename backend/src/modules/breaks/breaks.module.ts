import { Module } from '@nestjs/common';
import { BreaksController } from './breaks.controller.js';
import { BreaksService } from './breaks.service.js';

@Module({ controllers: [BreaksController], providers: [BreaksService] })
export class BreaksModule {}
