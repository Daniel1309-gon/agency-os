import { Module } from '@nestjs/common';
import { ReportsController, ShiftOverridesController, ShiftTemplatesController, ShiftsController } from './shifts.controller.js';
import { ShiftsService } from './shifts.service.js';

@Module({ controllers: [ShiftsController, ShiftTemplatesController, ShiftOverridesController, ReportsController], providers: [ShiftsService], exports: [ShiftsService] })
export class ShiftsModule {}
