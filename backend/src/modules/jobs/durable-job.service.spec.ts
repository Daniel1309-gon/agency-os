import { describe, expect, it, vi } from 'vitest';
import { DurableJobService } from './durable-job.service.js';

function harness() {
  const selected = [{ id: 7, jobName: 'audit:partitions', runKey: '2026-09', status: 'PROCESSING', attempts: 1 }];
  const repository = {
    enqueue: vi.fn(async () => true),
    claim: vi.fn(async () => selected),
    renew: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
  return { service: new DurableJobService(repository as never), repository };
}

describe('DurableJobService', () => {
  it('claims due work with a lease and returns the fenced execution', async () => {
    const h = harness();

    await expect(h.service.claim(1)).resolves.toMatchObject([{ id: 7, status: 'PROCESSING' }]);
    expect(h.repository.claim).toHaveBeenCalledWith(1, expect.stringMatching(/^job-worker-/));
  });

  it('only completes the execution when the lease token still owns it', async () => {
    const h = harness();
    h.repository.complete.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(h.service.complete(7, 'stale-token')).resolves.toBe(false);
    await expect(h.service.complete(7, 'current-token')).resolves.toBe(true);
  });
});
