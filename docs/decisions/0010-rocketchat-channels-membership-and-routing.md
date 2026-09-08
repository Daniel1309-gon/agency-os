# ADR 0010: canales, membresía y enrutamiento de Rocket.Chat

- Estado: aceptada
- Fecha: 2026-09-07
- Alcance: OQ-10, FR-36, FR-37, FR-38, COM-01, COM-02, COM-03

Resuelve OQ-10. La mitad de accesos quedó verificada contra el servidor real del cliente
(`chat.globalcompany.company`) durante el piloto del bot; esta ADR fija la mitad de reglas,
que era la que bloqueaba construir COM-01, COM-02 y COM-03.

## Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **Los canales de cuadrilla son privados** (`type = 'GROUP'`) | `CHANNEL` público | La operación de una cuadrilla no es información de toda la agencia. Obliga a usar la familia `groups.*` de la API, no `channels.*`; no son intercambiables. |
| 2 | **La membresía la administra el coordinador a mano en Rocket.Chat** | Worker que sincroniza `crew_members` con la membresía del canal | `crew_members.valid_range` es temporal y los relevos de 06:05/14:05/22:05 abren y cierran rangos a diario. Sincronizar produciría un vaivén constante de altas y bajas. Y sobre todo: automatizarlo obliga a darle al PAT de `agency.bot` permiso para invitar y expulsar, convirtiendo una cuenta que solo habla en una que puede sacar a cualquiera de cualquier sala. |
| 3 | **El backend detecta la deriva, no la corrige** | Reconciliación que escribe membresías | Consecuencia de #2: con membresía manual el desajuste es permanente, no excepcional. Detectar y reportar es correcto; corregir sería pelearse con el coordinador. Además es la única señal de que un ex-miembro sigue leyendo el canal. |
| 4 | **Salir del canal quita el acceso al historial** | Conservar lectura histórica | Es el comportamiento nativo de un grupo privado de Rocket.Chat al expulsar a alguien, y es lo que el cliente quiere. Depende de #1: en un canal público no se cumpliría. |
| 5 | **La alerta urgente va por DM al coordinador** | Fan-out al canal de la cuadrilla | Una llamada HTTP a una persona en vez de varias con reintentos. El presupuesto de FR-37 (p95 <1 s) deja de ser un problema de dimensionamiento. |

## Consecuencia sobre el criterio de aceptación de FR-36

`tasks/plan.md` §5 exigía que el worker *"crea/vincula canal, sincroniza miembros y registra
external ID; cambios de cuadrilla generan outbox"*. La decisión #2 **retira la sincronización de
miembros y el outbox por cambio de cuadrilla** de ese criterio. Lo que queda exigible:

- crear o vincular el canal y registrar su `rcRoomId`;
- un escaneo de deriva que reporte diferencias entre `crew_members` vigentes y la membresía real;
- auditoría de ambas cosas.

La enmienda fue solicitada explícitamente por el cliente el 2026-09-07 tras ver el piloto
funcionando; no es una reducción de alcance decidida por el equipo.

## Requisito operativo que esto crea

La decisión #5 depende de `users.rocketchat_direct_room_id`, hoy vacío para todos los usuarios.
Sin ese valor el worker lanza `PermanentDeliveryError` y la alerta urgente no sale — falla
cerrado, que es correcto, pero falla. **Poblarlo para cada coordinador es prerrequisito de
COM-02**, no un detalle de configuración.

## Alcance del token de servicio

Con estas decisiones, el PAT de `agency.bot` necesita:

- enviar mensajes (`chat.sendMessage`), ya en uso y verificado;
- leer la membresía de los canales donde el bot está, para el escaneo de deriva de #3.

**No necesita** invitar, expulsar, crear usuarios ni administrar el workspace. Cualquier
propuesta futura que requiera ampliarlo vuelve a abrir esta ADR.

## Lo que esta ADR no decide

- El patrón de nombres concreto de los canales de cuadrilla.
- Qué ocurre en el chat cuando una cuadrilla se renombra o se marca `is_active = false`.
- Si el semáforo (FR-38) se anuncia en el chat o vive solo en la web.

Las tres se pueden resolver durante la construcción de COM-01 sin bloquear su diseño, porque
ninguna cambia el modelo de permisos ni el de datos.
