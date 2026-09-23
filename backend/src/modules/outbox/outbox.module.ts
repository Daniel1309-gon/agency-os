import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';

export { OutboxService };

@Global()
@Module({ providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}
