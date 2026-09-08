import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { ShiftsModule } from '../shifts/shifts.module.js';

@Global()
@Module({ imports: [ShiftsModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
