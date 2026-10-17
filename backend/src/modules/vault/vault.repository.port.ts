export const VAULT_REPOSITORY = Symbol('VAULT_REPOSITORY');

export interface VaultDevice {
  id: string;
}

export interface VaultLaunchingSession {
  assignmentId: string;
  deviceId: string | null;
}

export interface VaultPreparedHandoffSession {
  operatorId: string;
  version: number;
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

export interface VaultProfileUpdate {
  loginEmail: string;
  version: number;
  updatedBy: string;
}

export interface VaultScopeActor {
  id: string;
  role: string;
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

export interface VaultAbuseAlertTargets {
  actorEmail?: string;
  profileName?: string;
  adminIds: string[];
  /** Canal ALERTS activo de Rocket.Chat, si se registro. */
  alertsChannelId?: string;
}

export interface VaultRepository {
  profileExistsForRotation(profileId: string, actor: VaultScopeActor): Promise<boolean>;
  currentCredentialVersion(profileId: string): Promise<number | undefined>;
  rotateCredential(rotation: VaultCredentialRotation, profile?: VaultProfileUpdate): Promise<void>;
  currentCredentialMetadata(profileId: string): Promise<VaultCredentialMetadata | undefined>;
  findApprovedDevice(deviceId: string): Promise<VaultDevice | undefined>;
  activeProfileExists(profileId: string): Promise<boolean>;
  sessionChromeBindingMatches(input: {
    sessionId: string;
    profileId: string;
    operatorId: string;
  }): Promise<boolean>;
  findLaunchingSession(input: {
    sessionId: string;
    profileId: string;
    operatorId: string;
    deviceId: string;
  }): Promise<VaultLaunchingSession | undefined>;
  findPreparedHandoffSession(input: {
    sessionId: string;
    profileId: string;
    deviceId: string;
    notBefore: Date;
  }): Promise<VaultPreparedHandoffSession | undefined>;
  findActiveAssignment(input: {
    assignmentId: string;
    profileId: string;
    operatorId: string;
  }): Promise<VaultAssignment | undefined>;
  recordCredentialAccess(record: VaultAccessRecord): Promise<void>;
  /** Marca el reuso del grant y devuelve el perfil de la fila, si el actor la puede ver. */
  markGrantReuse(grantId: string): Promise<string | undefined>;
  /** Sesion LAUNCHING del mismo perfil preparada por otra estacion (SEC-10). */
  findSessionPreparedByAnotherDevice(input: {
    sessionId: string;
    profileId: string;
    operatorId?: string;
    deviceId: string;
  }): Promise<{ operatorId: string } | undefined>;
  currentCredential(profileId: string): Promise<VaultEncryptedCredential | undefined>;
  markGrantConsumed(grantId: string, consumedAt: Date): Promise<void>;
  /** Destinatarios y nombres legibles de una alerta de abuso (SEC-10). */
  abuseAlertTargets(userId: string, profileId: string): Promise<VaultAbuseAlertTargets>;
  recordAbuseNotifications(adminIds: string[], notification: { body: string; profileId: string }): Promise<void>;
}
