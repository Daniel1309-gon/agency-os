# ADR 0014: acceso mTLS sin dependencia de la IP de oficina

- Estado: aceptada
- Fecha: 2026-09-22
- Alcance: plan de cierre de Entrega 1 (2026-09-20), fase B2; revisa el alcance de SEC-03 (ADR 0003)

## Contexto

El ADR 0003 (SEC-03) aplicó la allowlist de IP a todas las rutas, incluidas las públicas, como
protección de perímetro mientras la identidad de los equipos no estaba resuelta. El plan de
despliegue del 2026-09-20 (fase B2) cambió el modelo: la identidad de equipo es la huella SHA-256 del
certificado mTLS y la entrega de credenciales exige un dispositivo aprobado. Con ese cambio, seguir
exigiendo además una IP de oficina mantiene una dependencia operativa que el plan pidió eliminar
("eliminar la dependencia de la IP de oficina para el acceso mTLS; conservar IP para auditoría y
protección contra abuso").

## Decisión

1. **Un dispositivo aprobado no depende de la allowlist.** Si `ClientCertGuard` resolvió un
   dispositivo (`request.device`), `IpAllowlistGuard` deja pasar la solicitud. Lo mismo aplica al
   handshake WebSocket: con certificado de dispositivo verificado no se evalúa la IP.
2. **La allowlist sigue siendo la puerta de las rutas públicas y de lo anónimo**: login, refresh,
   enrollment y webhook de Rocket.Chat, y cualquier solicitud sin certificado de dispositivo (incluido
   el escape de desarrollo `DEV_CLIENT_CERT_FINGERPRINT`). El bootstrap inicial sigue siendo
   `db:bootstrap-ip`.
3. **La IP se conserva para auditoría y abuso**: heartbeat (`lastIp`), registro de denegaciones,
   límites de autenticación por IP y rate limits. No se elimina ningún registro.
4. **Orden de guards**: `ClientCertGuard` corre antes que `IpAllowlistGuard` para que la decisión del
   punto 1 vea la identidad ya resuelta. El cambio no altera qué rutas exigen certificado: lo define
   cada controlador (`@SkipClientCert`, `@AllowUnregisteredClientCert` o el default de producción).

## Consecuencias

- Cambiar de red de oficina (o trabajar desde otra sede) ya no requiere tocar `ip_allowlist` para
  operadores con PC enrolada; sí lo requiere para el login sin certificado.
- SEC-03 sigue vigente en su parte de perímetro (CIDR reales, proxies confiables, fail-closed sin
  allowlist) para todo lo que no presente certificado de dispositivo.
- Las pruebas de integración de guards cubren los dos caminos: dispositivo aprobado sin allowlist
  (pasa) y ruta pública sin dispositivo y sin allowlist (falla cerrado).
- **Riesgo residual aceptado:** el access token no está atado al certificado del dispositivo.
  Tras revocar el equipo A, su refresh token y sus sockets se invalidan, pero un access token ya
  emitido puede usarse desde otro equipo aprobado hasta vencer (máximo 15 minutos con
  `JWT_ACCESS_TTL_SECONDS=900`). El binding por dispositivo del access token queda fuera de E1.
