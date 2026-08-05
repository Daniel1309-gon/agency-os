import { Module } from '@nestjs/common';
import { OperatorStatusController } from './operator-status.controller.js';
import { OperatorStatusService } from './operator-status.service.js';

@Module({ controllers: [OperatorStatusController], providers: [OperatorStatusService] })
export class OperatorStatusModule {}
