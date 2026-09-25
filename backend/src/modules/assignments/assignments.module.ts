import { Module } from '@nestjs/common';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { AssignmentsController, AgentSessionsController, StationSessionsController } from './assignments.controller.js';
import { AssignmentsService } from './assignments.service.js';

@Module({ imports: [ProfilesModule], controllers: [AssignmentsController, AgentSessionsController, StationSessionsController], providers: [AssignmentsService] })
export class AssignmentsModule {}
