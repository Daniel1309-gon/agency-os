import { Injectable } from '@nestjs/common';
import { and, eq, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { shiftOverrides, shifts } from '../../database/schema/index.js';

/** Single source of truth for the window that authorizes an operator action. */
@Injectable()
export class ShiftAccessService {
  constructor(private readonly db: DatabaseService) {}

  async isWithinApprovedWindow(operatorId: string): Promise<boolean> {
    const shift = await this.db.db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(
        eq(shifts.operatorId, operatorId),
        or(eq(shifts.status, 'SCHEDULED'), eq(shifts.status, 'IN_PROGRESS')),
        sql`${shifts.scheduledRange} @> now()`,
      ))
      .limit(1);
    if (shift.length) return true;

    const override = await this.db.db
      .select({ id: shiftOverrides.id })
      .from(shiftOverrides)
      .where(and(eq(shiftOverrides.operatorId, operatorId), sql`${shiftOverrides.range} @> now()`))
      .limit(1);
    return override.length > 0;
  }
}
