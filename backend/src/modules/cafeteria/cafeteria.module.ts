import { Module } from '@nestjs/common';
import { CafeteriaController } from './cafeteria.controller.js';
import { CafeteriaService } from './cafeteria.service.js';

@Module({ controllers: [CafeteriaController], providers: [CafeteriaService], exports: [CafeteriaService] })
export class CafeteriaModule {}
