import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module.js';
import { NotificationsController, RocketChatController, ScheduledMessagesController } from './communication.controller.js';
import { CommunicationService } from './communication.service.js';

@Module({ imports: [OutboxModule], controllers: [RocketChatController, ScheduledMessagesController, NotificationsController], providers: [CommunicationService] })
export class CommunicationModule {}
