import { Module } from '@nestjs/common';
import { VaultController, AgentVaultController, StationVaultController } from './vault.controller.js';
import { VaultCryptoService } from './vault.crypto.js';
import { DrizzleVaultRepository } from './vault.drizzle-repository.js';
import { VAULT_REPOSITORY } from './vault.repository.port.js';
import { VaultService } from './vault.service.js';

@Module({
  controllers: [VaultController, AgentVaultController, StationVaultController],
  providers: [
    VaultCryptoService,
    { provide: VAULT_REPOSITORY, useClass: DrizzleVaultRepository },
    VaultService,
  ],
})
export class VaultModule {}
