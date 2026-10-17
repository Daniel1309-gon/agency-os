import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { OutboxOpsRepository } from './outbox-ops.drizzle-repository.js';

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD']).optional(),
  eventType: z.string().trim().min(1).max(80).optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Superficie operativa del outbox (E1-05): ver la cola y reprocesar lo fallido. */
@Injectable()
export class OutboxOpsService {
  constructor(
    private readonly repository: OutboxOpsRepository,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(query: Record<string, string | undefined>) {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const { status, eventType, cursor, limit } = parsed.data;
    const rows = await this.repository.list({ status, eventType, beforeId: cursor, limit });
    return { data: rows, pagination: { limit, nextCursor: rows.length === limit ? String(rows[rows.length - 1].id) : null } };
  }

  summary() {
    return this.repository.summary();
  }

  async requeue(rawId: string, actorId: string) {
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException('Outbox event id must be a positive integer');
    return this.db.transaction(async () => {
      const result = await this.repository.requeue(id);
      if (result.outcome === 'NOT_FOUND') throw new NotFoundException('Outbox event not found');
      if (result.outcome === 'NOT_REQUEUEABLE') throw new ConflictException(`Only FAILED or DEAD events can be requeued (current: ${result.status})`);
      await this.audit.record({ actorType: 'USER', actorUserId: actorId, action: 'outbox.requeued', entityType: 'outbox_event', result: 'SUCCESS', metadata: { eventId: id, eventType: result.eventType, aggregateType: result.aggregateType, fromStatus: result.previousStatus } });
      return { id, status: 'PENDING' as const };
    });
  }
}
