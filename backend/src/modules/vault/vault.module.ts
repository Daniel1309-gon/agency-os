import { Module } from '@nestjs/common';
import { VaultController, VaultKeyController, AgentVaultController, StationVaultController } from './vault.controller.js';
import { VaultAlertService } from './vault-alerts.service.js';
import { VaultCryptoService } from './vault.crypto.js';
import { DrizzleVaultRepository } from './vault.drizzle-repository.js';
import { VAULT_REPOSITORY } from './vault.repository.port.js';
import { VaultService } from './vault.service.js';

@Module({
  controllers: [VaultController, VaultKeyController, AgentVaultController, StationVaultController],
  providers: [
    VaultCryptoService,
    VaultAlertService,
    { provide: VAULT_REPOSITORY, useClass: DrizzleVaultRepository },
    VaultService,
  ],
})
export class VaultModule {}
