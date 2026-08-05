import { Module } from '@nestjs/common';
import { CompetitionsController, PayrollController } from './payroll.controller.js';
import { PayrollService } from './payroll.service.js';

@Module({ controllers: [PayrollController, CompetitionsController], providers: [PayrollService], exports: [PayrollService] })
export class PayrollModule {}
