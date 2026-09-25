# ADR 0004: límites distribuidos de autenticación y cookies de refresh

- Estado: aceptada
- Fecha: 2026-08-23
- Alcance: SEC-04

## Contexto

La rotación de refresh ya revoca atómicamente el token usado y detecta su
reutilización revocando la familia completa. Faltaban límites que no pudieran
evadirse repartiendo intentos entre IPs, un límite para refresh y un
comportamiento seguro si Redis no estaba disponible. La cookie de refresh
también tenía un TTL fijo distinto al TTL configurable del token.

## Decisión

Los contadores de autenticación viven en Redis y usan una ventana fija de 15
minutos:

- login: por IP normalizada y por cuenta;
- refresh: por IP y por cuenta, más por dispositivo cuando el token lo
  identifica.

Cada solicitud incrementa sus claves con expiración. Si Redis no puede
aplicar el límite, la operación de autenticación falla cerrada con `503`; no
se permite continuar sin protección distribuida. El límite de login es cinco
intentos por dimensión y el de refresh es treinta por dimensión en la ventana.

La cookie `agency_refresh` calcula `Max-Age` desde `JWT_REFRESH_TTL_DAYS` y
mantiene `HttpOnly`, `SameSite=Strict` y `Secure` en producción. La rotación
atómica y la revocación de familia por reuse detection se conservan.

## Alternativas rechazadas

- Limitar solo por la pareja IP/cuenta: un atacante distribuido puede cambiar
  de IP y seguir atacando la misma cuenta.
- Guardar contadores en memoria del proceso: no coordina las instancias del
  backend y se pierde al reiniciar.
- Permitir login o refresh cuando Redis está caído: convierte una falla de
  infraestructura en una apertura del perímetro de autenticación.
- Mantener el TTL de cookie hardcodeado: puede dejar una cookie viva más o
  menos tiempo que el refresh token configurado.

## Consecuencias

- Redis pasa a ser dependencia de disponibilidad para login y refresh; el
  fail-closed es intencional y debe estar cubierto por monitoreo y HA.
- Las claves contienen solo identificadores de límite (IP normalizada,
  email normalizado, user ID y device ID), nunca contraseñas ni tokens.
- Los contadores se reinician por expiración de Redis; no sustituyen la
  auditoría durable ni el bloqueo de cuenta por credenciales inválidas.
