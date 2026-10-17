/**
 * Catalogo cerrado de acciones de auditoria (SEC-07a). `AuditService.record` tipa
 * `action` con `AuditAction`, asi que una accion fuera de catalogo no compila; la
 * web toma de aqui el filtro y las etiquetas. `entity` es el `entity_type` que
 * escribe la accion (null cuando no apunta a una entidad).
 */
export const AUDIT_ACTIONS = {
  'auth.login': { entity: 'user', label: 'Inicio de sesión' },
  'auth.token.denied': { entity: null, label: 'Token rechazado' },
  'permission.denied': { entity: null, label: 'Permiso rechazado' },
  'role.denied': { entity: null, label: 'Rol rechazado' },
  'ip_allowlist.denied': { entity: null, label: 'IP rechazada' },
  'client_cert.denied': { entity: null, label: 'Certificado de equipo rechazado' },
  'device.access.denied': { entity: null, label: 'Dispositivo rechazado' },
  'realtime.connection.denied': { entity: null, label: 'Conexión en tiempo real rechazada' },
  'shift.access.denied': { entity: null, label: 'Acceso fuera de turno rechazado' },

  'user.created': { entity: 'user', label: 'Usuario creado' },
  'user.updated': { entity: 'user', label: 'Usuario actualizado' },
  'user.disabled': { entity: 'user', label: 'Usuario deshabilitado' },
  'compensation.created': { entity: 'compensation', label: 'Compensación registrada' },
  'setting.updated': { entity: 'setting', label: 'Ajuste actualizado' },
  'feature_flag.updated': { entity: 'feature_flag', label: 'Feature flag actualizado' },
  'ip_allowlist.created': { entity: 'ip_allowlist', label: 'Regla IP creada' },
  'ip_allowlist.disabled': { entity: 'ip_allowlist', label: 'Regla IP deshabilitada' },

  'device.created': { entity: 'device', label: 'Dispositivo creado' },
  'device.enrolled': { entity: 'device', label: 'Dispositivo enrolado' },
  'device.revoked': { entity: 'device', label: 'Dispositivo revocado' },
  'device.certificate.registered': { entity: 'device', label: 'Certificado de dispositivo registrado' },

  'crew.created': { entity: 'crew', label: 'Cuadrilla creada' },
  'crew.member_added': { entity: 'crew_member', label: 'Miembro agregado a cuadrilla' },
  'crew.member_removed': { entity: 'crew_member', label: 'Miembro retirado de cuadrilla' },

  'profile.created': { entity: 'profile', label: 'Perfil creado' },
  'profile.updated': { entity: 'profile', label: 'Perfil actualizado' },
  'profile.deactivated': { entity: 'profile', label: 'Perfil desactivado' },
  'assignment.created': { entity: 'assignment', label: 'Asignación creada' },
  'assignment.ended': { entity: 'assignment', label: 'Asignación finalizada' },
  'session.opened': { entity: 'session', label: 'Sesión de perfil abierta' },
  'session.transitioned': { entity: 'session', label: 'Sesión de perfil cambió de estado' },
  'session.heartbeat': { entity: 'session', label: 'Latido de sesión' },
  'session.close.confirmed': { entity: 'session', label: 'Cierre de navegador confirmado' },
  'session.closed': { entity: 'session', label: 'Sesión de perfil cerrada' },

  'vault.credential.issued': { entity: 'profile', label: 'Grant de credencial emitido' },
  'vault.credential.redeem': { entity: null, label: 'Intento de redención' },
  'vault.credential.redeemed': { entity: 'profile', label: 'Credencial entregada' },
  'vault.credential.denied': { entity: 'profile', label: 'Credencial rechazada' },
  'vault.credential.handoff': { entity: 'profile', label: 'Entrega a la estación' },
  'vault.credential.rotated': { entity: 'profile', label: 'Credencial rotada' },
  'vault.key.rotated': { entity: null, label: 'Clave del vault rotada' },

  'shift.created': { entity: 'shift', label: 'Turno creado' },
  'shift.started': { entity: 'shift', label: 'Turno iniciado' },
  'shift.ended': { entity: 'shift', label: 'Turno terminado' },
  'shift_template.created': { entity: 'shift_template', label: 'Plantilla de turno creada' },
  'shift_override.created': { entity: 'shift_override', label: 'Excepción de turno creada' },
  'shift_override.revoked': { entity: 'shift_override', label: 'Excepción de turno revocada' },
  'break.started': { entity: 'break', label: 'Break iniciado' },
  'break.ended': { entity: 'break', label: 'Break terminado' },

  'rocketchat.channel.created': { entity: 'rocketchat_channel', label: 'Canal de Rocket.Chat registrado' },
  'rocketchat.message.scheduled': { entity: 'scheduled_message', label: 'Mensaje programado' },
  'rocketchat.message.cancelled': { entity: 'scheduled_message', label: 'Mensaje programado cancelado' },
  'rocketchat.bot.knowledge.updated': { entity: 'bot_knowledge', label: 'Conocimiento del bot actualizado' },
  'rocketchat.bot.query': { entity: 'user', label: 'Consulta al bot' },
  'outbox.requeued': { entity: 'outbox_event', label: 'Entrega reintentada' },
} as const satisfies Record<string, { entity: string | null; label: string }>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export const auditActionCodes = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export function isAuditAction(value: string): value is AuditAction {
  return Object.hasOwn(AUDIT_ACTIONS, value);
}
