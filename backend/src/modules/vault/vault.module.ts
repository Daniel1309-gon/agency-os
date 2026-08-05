import { Module } from '@nestjs/common';
import { VaultController, AgentVaultController } from './vault.controller.js';
import { VaultCryptoService } from './vault.crypto.js';
import { VaultService } from './vault.service.js';

@Module({ controllers: [VaultController, AgentVaultController], providers: [VaultCryptoService, VaultService] })
export class VaultModule {}
