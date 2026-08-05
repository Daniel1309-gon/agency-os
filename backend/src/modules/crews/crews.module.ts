import { Module } from '@nestjs/common';
import { CrewsController } from './crews.controller.js';
import { CrewsService } from './crews.service.js';

@Module({ controllers: [CrewsController], providers: [CrewsService] })
export class CrewsModule {}
