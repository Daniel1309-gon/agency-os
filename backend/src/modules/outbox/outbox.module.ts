import { Global, Module } from '@nestjs/common';
import { OutboxController } from './outbox.controller.js';
import { OutboxOpsRepository } from './outbox-ops.drizzle-repository.js';
import { OutboxOpsService } from './outbox-ops.service.js';
import { OutboxService } from './outbox.service.js';

export { OutboxService };

@Global()
@Module({ controllers: [OutboxController], providers: [OutboxService, OutboxOpsRepository, OutboxOpsService], exports: [OutboxService] })
export class OutboxModule {}
