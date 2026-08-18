import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, UsePipes } from '@nestjs/common';
import { BypassIpAllowlist, CurrentUser, Public, RequirePermissions } from '../../common/auth/decorators.js';
import type { AccessTokenClaims } from '../../common/auth/crypto.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { botKnowledgeSchema, botWebhookSchema, channelSchema, messageSchema, scheduledMessageSchema, type BotKnowledgeInput, type BotWebhookInput, type ChannelInput, type MessageInput, type ScheduledMessageInput } from './communication.schemas.js';
import { CommunicationService } from './communication.service.js';
import { BotService } from './bot.service.js';

@Controller('rocketchat')
export class RocketChatController {
  constructor(private readonly communication: CommunicationService) {}
  @Get('channels') @RequirePermissions('chat.manage') channels(@CurrentUser() user: AccessTokenClaims) { return this.communication.channels(user); }
  @Post('channels') @RequirePermissions('chat.manage') @UsePipes(new ZodValidationPipe(channelSchema)) create(@Body() body: ChannelInput, @CurrentUser() user: AccessTokenClaims) { return this.communication.createChannel(body, user); }
  @Post('messages') @RequirePermissions('chat.manage') @UsePipes(new ZodValidationPipe(messageSchema)) message(@Body() body: MessageInput, @CurrentUser() user: AccessTokenClaims) { return this.communication.message(body, user); }
}

@Controller('rocketchat/bot')
export class RocketChatBotController {
  constructor(private readonly bot: BotService) {}

  @Public()
  @BypassIpAllowlist()
  @Post('events')
  @UsePipes(new ZodValidationPipe(botWebhookSchema))
  event(@Body() body: BotWebhookInput, @Headers('x-rocketchat-webhook-token') secret?: string) { return this.bot.handle(body, secret); }

  @Get('knowledge')
  @RequirePermissions('chat.manage')
  knowledge() { return this.bot.listKnowledge(); }

  @Put('knowledge/:slug')
  @RequirePermissions('chat.manage')
  @UsePipes(new ZodValidationPipe(botKnowledgeSchema))
  setKnowledge(@Param('slug') slug: string, @Body() body: BotKnowledgeInput, @CurrentUser() user: AccessTokenClaims) { return this.bot.setKnowledge(slug, body, user.sub); }
}

@Controller('scheduled-messages')
export class ScheduledMessagesController {
  constructor(private readonly communication: CommunicationService) {}
  @Post() @RequirePermissions('chat.manage') @UsePipes(new ZodValidationPipe(scheduledMessageSchema)) create(@Body() body: ScheduledMessageInput, @CurrentUser() user: AccessTokenClaims) { return this.communication.schedule(body, user); }
  @Get() @RequirePermissions('chat.manage') list(@CurrentUser() user: AccessTokenClaims) { return this.communication.scheduled(user); }
  @Delete(':id') @RequirePermissions('chat.manage') cancel(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.communication.cancelScheduled(id, user); }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly communication: CommunicationService) {}
  @Get() list(@CurrentUser() user: AccessTokenClaims) { return this.communication.userNotifications(user.sub); }
  @Patch(':id/read') read(@Param('id') id: string, @CurrentUser() user: AccessTokenClaims) { return this.communication.readNotification(id, user.sub); }
}
