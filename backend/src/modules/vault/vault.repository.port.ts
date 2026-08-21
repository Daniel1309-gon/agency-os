export const VAULT_REPOSITORY = Symbol('VAULT_REPOSITORY');

export interface VaultDevice {
  id: string;
}

export interface VaultLaunchingSession {
  assignmentId: string;
  deviceId: string | null;
}

export interface VaultAssignment {
  id: string;
}

export interface VaultCredentialMetadata {
  version: number;
  rotatedAt: Date;
  rotatedBy: string;
}

export interface VaultEncryptedCredential {
  username: string;
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
  keyVersion: number;
  aadContext: string;
}

export interface VaultCredentialRotation extends VaultEncryptedCredential {
  profileId: string;
  version: number;
  rotatedAt: Date;
  rotatedBy: string;
}

export interface VaultAccessRecord {
  profileId: string;
  userId?: string;
  deviceId?: string;
  assignmentId?: string;
  purpose: 'ADMIN_ROTATION' | 'LOGIN_INJECTION';
  granted: boolean;
  denyReason?: string;
  grantJti?: string;
  ip?: string;
  occurredAt?: Date;
}

export interface VaultRepository {
  profileExistsForRotation(profileId: string): Promise<boolean>;
  currentCredentialVersion(profileId: string): Promise<number | undefined>;
  rotateCredential(rotation: VaultCredentialRotation): Promise<void>;
  currentCredentialMetadata(profileId: string): Promise<VaultCredentialMetadata | undefined>;
  findApprovedDevice(tokenHash: string, deviceId?: string): Promise<VaultDevice | undefined>;
  activeProfileExists(profileId: string): Promise<boolean>;
  findLaunchingSession(input: {
    sessionId: string;
    profileId: string;
    operatorId: string;
    deviceId?: string;
  }): Promise<VaultLaunchingSession | undefined>;
  findActiveAssignment(input: {
    assignmentId: string;
    profileId: string;
    operatorId: string;
  }): Promise<VaultAssignment | undefined>;
  claimLaunchingSession(input: {
    sessionId: string;
    profileId: string;
    operatorId: string;
    deviceId: string;
    claimedAt: Date;
  }): Promise<boolean>;
  recordCredentialAccess(record: VaultAccessRecord): Promise<void>;
  markGrantReuse(grantId: string): Promise<void>;
  currentCredential(profileId: string): Promise<VaultEncryptedCredential | undefined>;
  markGrantConsumed(grantId: string, consumedAt: Date): Promise<void>;
}
