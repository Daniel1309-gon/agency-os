import { Module } from '@nestjs/common';
import { IcebreakersController, IcebreakerRulesController } from './icebreakers.controller.js';
import { IcebreakersService } from './icebreakers.service.js';
import { AiEngineClient } from './ai-engine.client.js';

@Module({ controllers: [IcebreakersController, IcebreakerRulesController], providers: [IcebreakersService, AiEngineClient], exports: [IcebreakersService] })
export class IcebreakersModule {}
