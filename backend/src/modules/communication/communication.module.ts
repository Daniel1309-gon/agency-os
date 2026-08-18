import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module.js';
import { NotificationsController, RocketChatBotController, RocketChatController, ScheduledMessagesController } from './communication.controller.js';
import { CommunicationService } from './communication.service.js';
import { CommunicationWorker } from './communication.worker.js';
import { RocketChatClient } from './rocketchat.client.js';
import { BotService } from './bot.service.js';

@Module({ imports: [OutboxModule], controllers: [RocketChatController, RocketChatBotController, ScheduledMessagesController, NotificationsController], providers: [CommunicationService, CommunicationWorker, RocketChatClient, BotService] })
export class CommunicationModule {}
