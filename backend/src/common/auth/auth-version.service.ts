import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { users } from '../../database/schema/index.js';
import { RealtimeService } from '../../modules/realtime/realtime.service.js';

/**
 * Sube `users.auth_version` y corta los sockets del usuario. Cualquier token
 * emitido antes deja de servir, tanto en HTTP (JwtAuthGuard) como al reconectar
 * el WebSocket (RealtimeGateway).
 */
@Injectable()
export class AuthVersionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
  ) {}

  async bump(userId: string): Promise<void> {
    await this.db.db
      .update(users)
      .set({ authVersion: sql`${users.authVersion} + 1` })
      .where(eq(users.id, userId));
    this.realtime.disconnectUser(userId);
  }
}
