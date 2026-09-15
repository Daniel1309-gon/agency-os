import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DurableJobRepository } from './durable-job.repository.js';

@Injectable()
export class DurableJobService {
  private readonly workerId = `job-worker-${randomUUID()}`;

  constructor(private readonly repository: DurableJobRepository) {}

  enqueue(jobName: string, runKey: string, scheduledFor: Date): Promise<boolean> {
    return this.repository.enqueue(jobName, runKey, scheduledFor);
  }

  claim(limit = 25) { return this.repository.claim(limit, this.workerId); }
  renew(id: number, leaseToken: string): Promise<boolean> { return this.repository.renew(id, leaseToken); }
  complete(id: number, leaseToken: string): Promise<boolean> { return this.repository.complete(id, leaseToken); }
  fail(id: number, leaseToken: string, error: string, attempts: number, dead = false): Promise<boolean> { return this.repository.fail(id, leaseToken, error, attempts, dead); }
}
