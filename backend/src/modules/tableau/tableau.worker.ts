import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../../config/config.service.js';
import { LoggerService } from '../../common/logger/logger.service.js';
import { TableauService } from './tableau.service.js';

const TICK_MS = 60_000;

/**
 * Executes queued Tableau ETL runs. Starts only in the dedicated worker
 * (DATABASE_RUNTIME_ROLE=worker), so a single process signs in with the PAT.
 */
@Injectable()
export class TableauWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private tickPromise?: Promise<void>;

  constructor(private readonly tableau: TableauService, private readonly config: ConfigService, private readonly logger: LoggerService) {}

  onModuleInit(): void {
    if (this.config.get('NODE_ENV') === 'test' || this.config.get('DATABASE_RUNTIME_ROLE') !== 'worker') return;
    this.timer = setInterval(() => this.startTick(), TICK_MS);
    this.startTick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.tickPromise;
  }

  private startTick(): void {
    if (this.tickPromise) return;
    this.tickPromise = this.tableau
      .processQueued()
      .then(() => undefined)
      .catch((error) => this.logger.error('Tableau ETL tick failed', { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => { this.tickPromise = undefined; });
  }
}
