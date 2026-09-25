import { describe, expect, it } from 'vitest';
import { ShiftAccessService, type ShiftAccessClock } from './shift-access.service.js';

function dbFor(...responses: unknown[][]) {
  const queue = [...responses];
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => queue.shift() ?? [] }),
        }),
      }),
    },
  } as never;
}

describe('ShiftAccessService', () => {
  it('accepts a currently scheduled/in-progress shift', async () => {
    const service = new ShiftAccessService(dbFor([{ id: 'shift-1' }]));
    await expect(service.isWithinApprovedWindow('operator-1')).resolves.toBe(true);
  });

  it('falls back to an approved override and rejects when neither exists', async () => {
    await expect(new ShiftAccessService(dbFor([], [{ id: 'override-1' }])).isWithinApprovedWindow('operator-1')).resolves.toBe(true);
    await expect(new ShiftAccessService(dbFor([], [])).isWithinApprovedWindow('operator-1')).resolves.toBe(false);
  });

  it('uses an injected clock when evaluating the half-open window', async () => {
    let now = new Date('2026-08-23T06:05:00.000Z');
    const clock: ShiftAccessClock = { now: () => now };
    const service = new ShiftAccessService(dbFor([{ id: 'shift-1' }], []), clock);

    await expect(service.isWithinApprovedWindow('operator-1')).resolves.toBe(true);
    now = new Date('2026-08-23T14:05:00.000Z');
    await expect(service.isWithinApprovedWindow('operator-1')).resolves.toBe(false);
  });
});
