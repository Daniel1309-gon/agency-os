import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '../../common/logger/logger.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { OutboxService } from '../outbox/outbox.module.js';
import { VAULT_REPOSITORY, type VaultRepository } from './vault.repository.port.js';

/**
 * Motivos alertables y su ventana de deduplicacion en segundos, por gravedad
 * (SEC-10): el limite de grants tambien es por hora, y el reuso o el uso desde
 * otra estacion son intentos puntuales.
 */
export const VAULT_ALERT_WINDOWS = {
  RATE_LIMITED: 3_600,
  GRANT_REUSE: 900,
  DEVICE_MISMATCH: 900,
  OPERATOR_MISMATCH: 900,
} as const;

export type VaultAlertReason = keyof typeof VAULT_ALERT_WINDOWS;

const REASON_COPY: Record<VaultAlertReason, string> = {
  RATE_LIMITED: 'superó el límite de 30 emisiones de credenciales por hora',
  GRANT_REUSE: 'intentó canjear un grant ya usado',
  DEVICE_MISMATCH: 'intentó usar un grant desde una estación distinta a la preparada',
  OPERATOR_MISMATCH: 'intentó canjear un grant de otro operador',
};

/**
 * Alertas por abuso del vault (SEC-10). Cada alerta deja una fila en
 * `notifications` para cada admin activo (se ve en el panel de Seguridad) y un
 * evento de outbox al canal privado de administración (purpose `ALERTS`).
 */
@Injectable()
export class VaultAlertService {
  constructor(
    @Inject(VAULT_REPOSITORY) private readonly repository: VaultRepository,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Deduplica por (motivo, operador, perfil) con `SET NX EX`: la primera alerta
   * sale al instante y las repetidas esperan la ventana. Es best-effort a
   * propósito: la denegación y su auditoría ya quedaron escritas (SEC-07b) y una
   * alerta que falle no debe romper el flujo del vault; queda el warn en el log.
   * Se escribe en una transacción propia porque el request termina en excepción y
   * la transacción del interceptor se revierte.
   */
  async raise(input: { userId: string; profileId: string; reason: VaultAlertReason }): Promise<void> {
    const key = `vault:alert:${input.reason}:${input.userId}:${input.profileId}`;
    try {
      const token = await this.redis.acquireLock(key, VAULT_ALERT_WINDOWS[input.reason]);
      if (!token) return;
      try {
        await this.db.independentTransaction(input.userId, 'OPERADOR', () => this.deliver(input));
      } catch (error) {
        await this.redis.releaseLock(key, token).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      this.logger.warn('Vault abuse alert could not be delivered', { reason: input.reason, profileId: input.profileId, error: String(error) });
    }
  }

  private async deliver(input: { userId: string; profileId: string; reason: VaultAlertReason }): Promise<void> {
    const targets = await this.repository.abuseAlertTargets(input.userId, input.profileId);
    const body = `El operador ${targets.actorEmail ?? input.userId} ${REASON_COPY[input.reason]} en el perfil ${targets.profileName ?? input.profileId}. Revisa Seguridad para el detalle.`;
    await this.repository.recordAbuseNotifications(targets.adminIds, { body, profileId: input.profileId });
    if (targets.alertsChannelId) {
      await this.outbox.enqueue('rocketchat.message.send', 'vault_alert', input.profileId, { channelId: targets.alertsChannelId, body });
    } else {
      // Sin canal ALERTS registrado la fila de `notifications` sigue siendo el
      // registro; el canal se registra con POST /rocketchat/channels.
      this.logger.debug('Vault abuse alert has no ALERTS channel to publish to', { profileId: input.profileId });
    }
  }
}
