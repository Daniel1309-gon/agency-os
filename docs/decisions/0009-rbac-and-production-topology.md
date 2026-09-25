# ADR 0009: operational scope and production topology baseline

- Estado: aceptada como baseline de Entrega 1
- Fecha: 2026-08-26
- Alcance: OQ-01, OQ-02, OQ-12, SEC-02, SEC-03, ASY-03

## Matriz de autorización

| Rol | Alcance | Facultades fuera de alcance |
|---|---|---|
| ADMIN | Toda la agencia | Ninguna dentro del sistema |
| DIRECTOR_OPERATIVO | Toda la operación, reportes, chat y cafetería | Usuarios privilegiados, RBAC, allowlist, configuración, vault y dispositivos |
| COORDINADOR | Cuadrillas activas coordinadas, sus operadores y perfiles asignados | Otras cuadrillas, seguridad global, vault de administración y reglas globales |
| OPERADOR | Sus turnos, sesiones, perfiles asignados y sus propios icebreakers | Otros operadores y administración |
| CAFETERIA | Catálogo, pedidos y KDS | Operación de perfiles, nómina y vault |

El review de icebreakers es jerárquico: Coordinador solo revisa autores de sus cuadrillas vigentes;
Director Operativo y ADMIN pueden revisar globalmente. Las consultas de aplicación y las policies de
PostgreSQL aplican la misma frontera. El seed reconcilia permisos de roles de sistema, por lo que
quitar un permiso no deja un grant histórico.

## Baseline de disponibilidad

- Dos instancias stateless de API detrás de un balanceador gestionado.
- Un proceso worker separado con conexión `DATABASE_WORKER_URL`; los leases del outbox sobreviven al
  reinicio y evitan que una instancia vieja marque como suyo un evento reclamado por otra.
- PostgreSQL gestionado con primary/standby, failover y PITR; Redis gestionado en modo HA.
- Object storage privado para exportes y artefactos raw, con URL firmada y expiración; no se usa el
  filesystem efímero de la API.
- Backups diarios y restore drill en entorno aislado. Objetivos operativos: RPO máximo de 5 minutos
  y RTO objetivo de 30 minutos.
- El LB/proxy debe entregar su CIDR real en `TRUSTED_PROXY_CIDRS`; producción falla cerrado si falta
  o es inválido. La matriz no inventa ese CIDR: queda como parámetro del proveedor elegido.

Esta baseline resuelve la decisión de diseño de OQ-12; QUA-03 sigue pendiente hasta ejecutar el
failover y restore drill sobre la infraestructura contratada.
