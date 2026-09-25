import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { shiftOverrides, shifts } from '../../database/schema/index.js';

export interface ShiftAccessClock {
  now(): Date;
}

export const SHIFT_ACCESS_CLOCK = Symbol('agency-os.shift-access-clock');
export const systemShiftAccessClock: ShiftAccessClock = { now: () => new Date() };

/** Single source of truth for the window that authorizes an operator action. */
@Injectable()
export class ShiftAccessService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(SHIFT_ACCESS_CLOCK) private readonly clock: ShiftAccessClock = systemShiftAccessClock,
  ) {}

  async isWithinApprovedWindow(operatorId: string, at = this.clock.now()): Promise<boolean> {
    const shift = await this.db.db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(
        eq(shifts.operatorId, operatorId),
        or(eq(shifts.status, 'SCHEDULED'), eq(shifts.status, 'IN_PROGRESS')),
        sql`${shifts.scheduledRange} @> ${at}::timestamptz`,
      ))
      .limit(1);
    if (shift.length) return true;

    const override = await this.db.db
      .select({ id: shiftOverrides.id })
      .from(shiftOverrides)
      .where(and(eq(shiftOverrides.operatorId, operatorId), isNull(shiftOverrides.revokedAt), sql`${shiftOverrides.range} @> ${at}::timestamptz`))
      .limit(1);
    return override.length > 0;
  }
}
