import { Module } from '@nestjs/common';
import { ReportsController, ShiftOverridesController, ShiftTemplatesController, ShiftsController } from './shifts.controller.js';
import { ShiftsService } from './shifts.service.js';
import { DrizzleEffectiveTimeRepository } from './effective-time.drizzle-repository.js';
import { EFFECTIVE_TIME_REPOSITORY } from './effective-time.port.js';

@Module({
  controllers: [ShiftsController, ShiftTemplatesController, ShiftOverridesController, ReportsController],
  providers: [{ provide: EFFECTIVE_TIME_REPOSITORY, useClass: DrizzleEffectiveTimeRepository }, ShiftsService],
  exports: [ShiftsService, EFFECTIVE_TIME_REPOSITORY],
})
export class ShiftsModule {}
