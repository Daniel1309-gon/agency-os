import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { LoggerModule } from './common/logger/logger.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthCommonModule } from './common/auth/auth.module.js';
import { RedisModule } from './common/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { VaultModule } from './modules/vault/vault.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { AssignmentsModule } from './modules/assignments/assignments.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { ShiftsModule } from './modules/shifts/shifts.module.js';
import { PayrollModule } from './modules/payroll/payroll.module.js';
import { CafeteriaModule } from './modules/cafeteria/cafeteria.module.js';
import { IcebreakersModule } from './modules/icebreakers/icebreakers.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { TableauModule } from './modules/tableau/tableau.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { CrewsModule } from './modules/crews/crews.module.js';
import { JobsModule } from './modules/jobs/jobs.module.js';
import { OperatorStatusModule } from './modules/operator-status/operator-status.module.js';
import { BreaksModule } from './modules/breaks/breaks.module.js';
import { CommunicationModule } from './modules/communication/communication.module.js';
import { InterceptorsModule } from './common/interceptors/interceptors.module.js';
import { AuditModule } from './common/audit/audit.module.js';

@Module({
  imports: [ConfigModule, LoggerModule, DatabaseModule, RedisModule, AuthCommonModule, AuditModule, InterceptorsModule, HealthModule, AuthModule, VaultModule, ProfilesModule, DevicesModule, AssignmentsModule, MetricsModule, ShiftsModule, PayrollModule, CafeteriaModule, IcebreakersModule, OutboxModule, TableauModule, AdminModule, CrewsModule, JobsModule, OperatorStatusModule, BreaksModule, CommunicationModule],
})
export class AppModule {}
