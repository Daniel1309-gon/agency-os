import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';
import { DurableJobService } from './durable-job.service.js';
import { DurableJobRepository } from './durable-job.repository.js';
import { ShiftsModule } from '../shifts/shifts.module.js';

@Global()
@Module({ imports: [ShiftsModule], providers: [JobsService, DurableJobRepository, DurableJobService], exports: [JobsService, DurableJobService] })
export class JobsModule {}
