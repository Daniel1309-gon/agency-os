import { describe, expect, it } from 'vitest';
import { shiftOverrideSchema } from './shifts.schemas.js';

describe('shiftOverrideSchema', () => {
  it('compares override instants, not ISO strings with different offsets', () => {
    expect(() => shiftOverrideSchema.parse({
      operatorId: '00000000-0000-4000-8000-000000000001',
      validFrom: '2026-08-23T01:00:00-05:00',
      validTo: '2026-08-23T05:30:00Z',
      type: 'OVERTIME',
      reason: 'Invalid reversed window',
    })).toThrow('validTo must be after validFrom');
  });
});
