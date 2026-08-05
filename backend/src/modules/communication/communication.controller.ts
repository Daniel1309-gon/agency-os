import { Body, Controller, Delete, Get, Param, Patch, Post, UsePipes } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { channelSchema, messageSchema, scheduledMessageSchema, type ChannelInput, type MessageInput, type ScheduledMessageInput } from './communication.schemas.js';
import { CommunicationService } from './communication.service.js';

@Controller('rocketchat')
export class RocketChatController {
  constructor(private readonly communication: CommunicationService) {}
  @Get('channels') channels() { return this.communication.channels(); }
  @Post('channels') @RequirePermissions('chat.manage') @UsePipes(new ZodValidationPipe(channelSchema)) create(@Body() body: ChannelInput) { return this.communication.createChannel(body); }
  @Post('messages') @UsePipes(new ZodValidationPipe(messageSchema)) message(@Body() body: MessageInput, @CurrentUser() user: AccessTokenClaims) { return this.communication.message(body, user.sub); }
}

@Controller('scheduled-messages')
export class ScheduledMessagesController {
  constructor(private readonly communication: CommunicationService) {}
  @Post() @RequirePermissions('chat.manage') @UsePipes(new ZodValidationPipe(scheduledMessageSchema)) create(@Body() body: ScheduledMessageInput, @CurrentUser() user: AccessTokenClaims) { return this.communication.schedule(body, user.sub); }
  @Get() @RequirePermissions('chat.manage') list(@CurrentUser() user: AccessTokenClaims) { return this.communication.scheduled(user.sub); }
  @Delete(':id') @RequirePermissions('chat.manage') cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.communication.cancelScheduled(id, user.sub); }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly communication: CommunicationService) {}
  @Get() list(@CurrentUser() user: AccessTokenClaims) { return this.communication.userNotifications(user.sub); }
  @Patch(':id/read') read(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.communication.readNotification(id, user.sub); }
}
