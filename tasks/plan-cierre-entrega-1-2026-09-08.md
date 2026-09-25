# Plan de cierre de Entrega 1 — Agency OS

Fecha: 2026-09-08. Estado: en ejecución; E1-00, E1-01, E1-02, E1-03 y el slice técnico E1-04a están implementados en el árbol de trabajo con evidencia separada. Las casillas de aceptación permanecen abiertas hasta disponer de commit, recorrido de navegador y pruebas PostgreSQL/Redis con dos workers. No autoriza despliegues ni mensajes al cliente. Responsable técnico: Daniel.

## 1. Resultado y límites

Cerrar Seguridad operacional con autenticación/RBAC/IP, vault, perfiles y asignaciones, acceso mediante extensión/helper, control de turnos y breaks, semáforo web y bot de ayuda. Cada requisito debe tener evidencia sobre el commit que se entrega, además de instrucciones de operación y recuperación.

La prueba física INT-01 con ocho perfiles conserva su condición de gate externo: se excluye del trabajo de construcción de este plan, pero no de la aceptación final. Haber terminado este plan sin INT-01 significa «software listo para validación física», no «Entrega 1 aceptada».

No se incluyen Tableau/ETL, nómina, cafetería completa, IA/icebreakers avanzados ni implementación de FR-39/Feature #9. Su investigación de viabilidad conserva su registro independiente. No cambia precio, cuotas ni cronograma contractual.

## 2. Fuentes, precedencia y discrepancias

- [Propuesta comercial v3, Entrega 1](<../../../FREELANCE/AGENCIA CAROL/documentos/agency-os-propuesta-comercial-v3.md>): incluye expresamente turnos y breaks, semáforo y bot.
- [Requerimientos vigentes v2.2](<../../../FREELANCE/AGENCIA CAROL/documentos/agency-os-requerimientos.md>): FR y NFR; su §9 sitúa FR-14 en E2. No usar la copia congelada de JarvisBot.
- [Decisiones del proyecto](../agents.md), [ADR 0009](../docs/decisions/0009-rbac-and-production-topology.md), [ADR 0010](../docs/decisions/0010-rocketchat-channels-membership-and-routing.md) y [ADR 0011](../docs/decisions/0011-effective-time-formula.md): decisiones posteriores explícitas sobre permisos, HA, chat y tiempo efectivo.
- [Plan general](plan.md), [checklist general](todo.md), [matriz](requirements-matrix.md) y catálogo JSON: trazabilidad que debe reconciliarse; las casillas no sustituyen evidencia.
- [Checkpoints 1–3](evidence/checkpoints-1-3-2026-09-07.md), [reinicio de API](evidence/checkpoint-2-restart-2026-09-08.md), [OPS-07](evidence/ops-07-effective-time-2026-09-08.md), [piloto Rocket.Chat](evidence/rocketchat-bot-pilot-2026-09-07.md), [HA local](evidence/ha-local-game-day-2026-08-26.md).

Correcciones de alcance para ejecutar:

1. FR-14 figura E1 en la matriz local, pero E2 en §9 de la fuente vigente. Corregir la matriz/catálogo con cita; conservar en E1 el heartbeat y el estado de sesión necesarios para seguridad y semáforo. No construir ingesta de métricas de negocio para cerrar E1.
2. La propuesta incluye breaks en E1 aunque §9 de requerimientos agrupa un control más completo con E2. Mantener el slice ya autorizado y probado (WEB-01/OPS-07); no añadir reglas de nómina por cruce de mes.
3. El semáforo web sí es obligatorio; anunciarlo en chat queda abierto en ADR 0010. No bloquear E1 por no publicarlo en chat ni construir anuncios sin resolver esa elección.
4. Mensajes programados de una ejecución existen; recurrencias se rechazan explícitamente. FR-37 pide programación anticipada, mientras COM-02 añade recurrencia. Resolver su necesidad con la fuente/decisión comercial antes de ampliar el contrato.
5. COM-01/02 son deuda de E0 y soporte de E1. Identificar lo necesario para bot, breaks y alertas sin presentar la integración avanzada de E2 como requisito nuevo de E1.

## 3. Baseline comprobada y nivel de certeza

Inspección local del 2026-09-08; no se ejecutó la suite global para redactar este documento. Las ejecuciones anteriores son evidencia histórica, no una nueva corrida.

| Área | Lo que existe | Cierre pendiente |
|---|---|---|
| SEC-11 | Diff del guard limita el catch a JWT; cliente conserva token ante errores transitorios. Revisión previa: 28 tests y ambos typechecks verdes. | Integrar evidencia y gate del commit final. AuthProvider aún trata un error de restauración como sesión anónima. |
| Seguridad | Checkpoint 1 documentado; RLS bajo rol runtime e inmutabilidad/partición probadas. | Auditoría integral, operación de claves, abuso y parámetros reales de despliegue. |
| Operación | Checkpoint 2 cerrado por OPS-07 y reinicio de API; frontend E1 registrado como terminado. | Verificar casillas residuales frente a pruebas; ampliar únicamente brechas reproducibles. |
| Jobs | `JobsService` ejecuta intervalos y locks Redis con TTL; materializa/cierra turnos, reap de sesiones, avisos y particiones. | Recuperación persistente, exclusión durante ejecuciones largas, errores observables y cierre tardío correcto. |
| Outbox | `OutboxService` tiene claim transaccional, leases, fencing por token en llamadas del worker, backoff y estado DEAD. | Superficie de inspección/reproceso, métricas y escenarios de fallos parciales. No reemplazarlo entero. |
| Comunicación | `CommunicationWorker.enqueueDueScheduled()` encola mensajes vencidos; test de reintento con misma clave. | No construir otro dispatcher. Comprobar DM, urgencias, deriva, recurrencia si aplica y configuración permanente. |
| Vault | `rotate`, `rotateEncryptionKey`, DEK versionadas, grant/redeem/handoff y límites existen. | No confundir rotar contraseña, DEK y KEK; demostrar concurrencia, recifrado y recuperación. |
| Audit | Escritor central y filtrado de metadata ya existen. | Catálogo, cobertura, atomicidad y tratamiento de fallos de denegación; no crear un segundo escritor. |
| HA | ADR define dos APIs, worker separado, Postgres/Redis HA; game day local parcial. | Failover/PITR/RPO/RTO en infraestructura contratada. |

Archivos inspeccionados: `backend/src/modules/jobs/jobs.service.ts`, `backend/src/modules/outbox/outbox.service.ts`, `backend/src/modules/communication/communication.worker.ts`, `communication.service.ts`, `backend/src/common/audit/audit.service.ts`, `backend/src/modules/vault/vault.service.ts`, `vault.crypto.ts`, scripts raíz y `tools/ci-verify.mjs`.

## 4. Reglas de ejecución y evidencia

- Una tarea es un cambio pequeño verificable; dividir una tarea si supera cinco archivos de lógica o mezcla subsistemas independientes. Migraciones/contratos pueden requerir PRs sucesivos.
- Antes de editar, seguir el flujo y todos sus llamadores. Si la aceptación ya pasa con una prueba adecuada, registrar evidencia y no reimplementar.
- Reutilizar BD, outbox, worker, auditoría y DTO existentes. No introducir BullMQ u otra cola por defecto. El diseño propuesto usa almacenamiento existente; la decisión final se registra antes de migrar.
- Documentación de librerías/API/CLI: al implementar, usar Context7 (resolve-library-id y query-docs) para la versión instalada y el concepto concreto. Este plan no prescribe nueva sintaxis de proveedor ni valida APIs externas.
- Cada cierre registra commit, entorno, comando, salida/resumen, prueba nombrada, esperado/obtenido y limitaciones. Evidencia sanitizada en `tasks/evidence/e1-<id>-<fecha>.md`.
- No registrar credenciales, cookies, PAT, datos de clientes ni payloads completos del vault. Usar cuentas y secretos sintéticos para abuso y recuperación.
- Pruebas focales por cambio; suite completa en checkpoints y candidato final. Conservar integraciones reales para transacciones, concurrencia, RLS y recuperación; mocks no demuestran estos atributos.
- Los gates que toquen infraestructura, retención o destinatarios reales se ejecutan en el entorno expresamente autorizado. Planificar no equivale a enviar mensajes ni contratar servicios.

## 5. Secuencia y dependencias

```text
E1-00 Reconciliar alcance/evidencia
  ├─ E1-01 SEC-11 → E1-02 Restauración web
  ├─ E1-03 Contrato de recuperación → E1-04 Scheduler → E1-05 Fallos outbox → E1-06 Checkpoint 3
  ├─ E1-07 Auditoría → E1-08 Retención → E1-09 Claves → E1-10 Abuso vault
  └─ E1-11 Operación → E1-12 Realtime
E1-05/07 → E1-13 Vinculaciones chat → E1-14 Programación/urgencias → E1-15 Bot permanente
E1-06/08/09/10/11/12/15 → E1-16 Seguridad despliegue → E1-17 Carga → E1-18 HA
E1-18 + INT-01 aprobado → E1-19 Aceptación final
```

Trabajo independiente posible: revisión de operación, catálogo de auditoría y preparación de entradas del despliegue. Coordinar cambios en schema, jobs, outbox y contratos; no editar esas superficies simultáneamente sin repartir propiedad. Este plan no requiere subagentes.

## 6. Tareas ejecutables

### E1-00 — Reconciliar alcance y evidencia (S; sin dependencias)

Trabajo: actualizar matriz/catálogo/checklist con las discrepancias de §2; para cada SEC/OPS/ASY/COM abierto clasificar CONSTRUIR, VERIFICAR, EXTERNO o FUERA-E1. Mantener el historial de evidencias y el estado original de las corridas.

Aceptación:
- Cada requisito E1 tiene una tarea de este plan o una prueba ya ejecutada y enlazada; ningún pendiente queda oculto por agruparlo.
- FR-14, recurrencia y semáforo en chat tienen alcance explícito; las decisiones no resueltas siguen abiertas.
- SEC-02, OPS-07, WEB-01 y checkpoints 1/2 no reaparecen como trabajo nuevo.

Verificación: `pnpm test:requirements`; revisar enlaces y correspondencia JSON/Markdown. Archivos: matriz, catálogo y `todo.md`; evidencia E1-00 con tabla requisito→prueba→brecha. Responsable: Daniel; decisiones comerciales, clienta cuando la fuente no resuelva.

### E1-01 — Cerrar SEC-11 sobre el candidato real (S; E1-00)

Trabajo: conservar el diff revisado del guard y cliente. Completar cobertura mínima de rechazo asíncrono de la consulta, 401 real al renovar y 500 al renovar si no está cubierta; no duplicar escenarios existentes.

Aceptación:
- Error de BD llega como 500 y no crea denegación INVALID_TOKEN; token inválido/usuario inactivo siguen siendo 401 auditables.
- Refresh o reintento con 500/red conserva token y propaga el error real; 401 definitivo limpia token.
- SEC-11 tiene evidencia enlazada al commit, sin cerrar otros SEC por asociación.

Verificación: tests `guards.spec.ts`, `api-client.test.ts`, filtro global y ambos typechecks; integración HTTP focal si falta el contrato guard→filtro. Archivos: los cuatro del diff actual y evidencia; dividir la prueba HTTP si exige otro PR.

### E1-02 — Restaurar sesión frente a fallo transitorio (S; E1-01)

Trabajo: corregir el caso preexistente de `AuthProvider` al iniciar la página: distinguir sesión rechazada de servicio temporalmente indisponible y permitir reintentar sin volver a introducir credenciales. Mantener bloqueadas las vistas protegidas hasta validar usuario.

Aceptación:
- 500/red durante refresh o `/auth/me` muestra estado recuperable y no una afirmación falsa de sesión expirada.
- 401 definitivo sí devuelve al login; una recuperación exitosa obtiene usuario y permisos actuales.
- Desmontaje/cancelación y reintentos no dejan un estado autenticado obsoleto.

Verificación: pruebas de las tres transiciones y recorrido en navegador con respuestas controladas. Archivos: `web-app/src/auth/AuthProvider.tsx`, presentación de estado y test focal (máximo 3–4). Mejora de continuidad, no requisito nuevo de autenticación.

Checkpoint A (E1-00…02): trazabilidad válida, regresiones de autenticación verdes, errores de infraestructura diferenciados.

### E1-03 — Definir recuperación de cada job (S; E1-00)

Trabajo: inventariar jobs E1 y definir por tipo identidad de ejecución, vencimiento, política de recuperación y límite de procesamiento. Propuesta: persistir próximos vencimientos/ejecuciones en PostgreSQL y reutilizar worker; polling solo despierta trabajo durable. Comparar con reconciliación idempotente desde tablas antes de añadir registros que no hagan falta.

Aceptación:
- Materialización recupera fechas omitidas de forma acotada; cierres usan el borde de negocio y no la hora de recuperación.
- Reaper/particiones reconcilian estado actual; avisos de break vencidos no se envían como si fueran anticipados. Determinar política explícita de expiración.
- Documentar leases/fencing, reloj autoritativo, backlog, permisos por job y qué ocurre al fallar BD/Redis. No conceder acceso general al vault al worker.

Verificación: tabla job→disparador→idempotencia→recuperación→permiso revisada contra `JobsService`, módulos de arranque y migraciones de roles. Salida: ADR propuesta con alternativas y criterio de elección. No migrar todavía.

### E1-04 — Ejecutar y recuperar jobs E1 (M por slice; E1-03)

Dividir en E1-04a persistencia/claim (schema+migración+servicio+test), E1-04b materialización/cierre (jobs+tests), E1-04c reaper/avisos/particiones (jobs+tests). Cada slice deja la aplicación arrancable.

Aceptación:
- Reinicio antes/después del claim recupera trabajo sin duplicar efectos; un ejecutor cuyo lease venció no confirma trabajo reclamado por otro.
- Una ejecución mayor que el TTL no solapa efectos con la siguiente; fallos no quedan como promesas rechazadas sin manejo ni ticks perdidos silenciosamente.
- Caída cruzando 14:05/medianoche/mes no agrega minutos de caída a turno/break; conserva OPS-07, no genera turnos duplicados y procesa backlog por lotes.

Verificación: PostgreSQL/Redis reales, dos workers, reloj controlado y reinicio de proceso; probar con rol autorizado real de cada job. Archivos: jobs, schema/migración y `shifts-and-crews.int.spec.ts` o nuevo test focal. No trasladar todos los jobs al worker sin verificar sus grants.

### E1-05 — Operar fallos del outbox existente (M por slice; E1-04a y E1-07 para auditoría de reproceso)

Dividir en E1-05a consulta paginada/reproceso autorizado; E1-05b métricas y regresiones de recuperación. Usar superficie administrativa existente o herramienta operativa autenticada; no crear un dashboard completo si un listado y acción bastan.

Aceptación:
- Operador autorizado ve DEAD, intentos, antigüedad y error sanitizado; nunca payload sensible. El reproceso tiene motivo, auditoría y CAS; concurrencia no duplica la transición.
- Reutiliza identidad idempotente y leases. Probar caída tras envío remoto y antes de marcar SENT, y entre actualización outbox y `scheduled_messages`; no prometer exactly-once externo sin evidencia.
- Medir pendientes/vencidos/DEAD, edad del más antiguo y última ejecución exitosa; mensajes expirados o con destino revocado no se reenvían ciegamente.

Verificación: tests de outbox/communication con fallos inyectados y rol runtime; prueba de acceso ajeno. Archivos: módulo outbox, módulo administrativo, DTO y test (separar contratos si supera 5 archivos).

### E1-06 — Cerrar Checkpoint 3 (S; E1-04/05)

Aceptación:
- Reinicio de API, worker y Redis durante pendientes deja estados recuperables; dos instancias no confirman leases ajenos.
- Evento cruza dos APIs y reconexión obtiene snapshot coherente; se documenta pérdida/recuperación durante la caída del adaptador.
- Evidencia muestra jobs recuperados, métricas y reproceso real de un DEAD sintético.

Verificación: ampliar pruebas existentes `communication.int.spec.ts` y `realtime-redis.int.spec.ts` sin sustituir procesos reales por recreación de objetos. Usar stack aislado; guardar tiempos y secuencia. Checkpoint B: suite de integración completa sobre base de prueba.

### E1-07 — Cerrar auditoría de operaciones E1 (M por slice; E1-00)

Trabajo: inventariar eventos y llamadores del escritor actual; añadir solo ausencias. Separar E1-07a catálogo/sanitización y E1-07b atomicidad de mutaciones sensibles.

Aceptación:
- Tabla acción→actor→resultado→campos permitidos→prueba para auth, perfil, asignación, sesión, turno, device, vault y chat E1; datos anidados/profundos no eluden la política.
- Fallar auditoría revierte mutación sensible que debe ser atómica. Revisar llamadas fuera de transacción; no asumir atomicidad por usar el mismo servicio.
- Denegación previa a transacción conserva rechazo y dispone de señal operativa sanitizada si no puede persistirse; una caída de BD no se clasifica como ataque.

Verificación: secretos sintéticos anidados y bajo claves permitidas, fallos de escritura, rollback y actores runtime. Archivos: `common/audit`, `denial-audit.ts`, llamadores afectados y tests focales; un PR por módulo para atomicidad.

### E1-08 — Operar retención y consulta audit (S/M; E1-07; OQ-08 para borrar)

Aceptación:
- Consulta por cursor estable con PK compuesta, filtros y scope; no se pierde información al paginar fechas coincidentes.
- Particiones futuras/default e inmutabilidad conservan sus pruebas; se observa fallo del mantenimiento y crecimiento.
- Clienta fija retención o acepta explícitamente conservación total provisional con fecha de revisión; no activar borrado antes de la decisión. Ensayar archivo/restore con datos sintéticos.

Verificación: pruebas de invariantes existentes más paginación y retención en BD desechable. Archivos: administración audit, setting/runbook y test. Entregable: política operativa, responsable y evidencia; no reescribir migración aplicada de particionado.

### E1-09 — Rotación y recuperación del vault (M por slice; E1-07)

Separar E1-09a concurrencia DEK/credencial, E1-09b recifrado reanudable y E1-09c runbook de KEK/restore. Reutilizar `VaultCryptoService` y repository existentes.

Aceptación:
- Dos rotaciones concurrentes no eligen una versión contradictoria; lecturas antiguas y nuevas funcionan. Revisar el patrón actual `currentKeyVersion()+1` antes de darlo por cerrado.
- Recifrado por lotes es reanudable y no sobrescribe una contraseña rotada concurrentemente; valida vínculo perfil/versión y conserva claves requeridas por backups.
- Restaurar BD y material de claves recupera credenciales sintéticas. Documentar que cambiar `VAULT_KEK` directamente no rota los DEK envueltos; procedimiento de reenvoltura/rollback comprobado antes de sustituirla.

Verificación: integración vault con fallo a mitad de lote, dos solicitudes, clave incorrecta y recuperación aislada. Ningún secreto aparece en logs/evidencia. Archivos: crypto/repository, migración si necesaria, herramienta administrativa y tests repartidos en slices.

### E1-10 — Abuso del vault y revocación (M por slice; E1-05/07/09)

Trabajo: cotejar SEC-10 del plan general con controles existentes; fijar disparadores basados en denegaciones reales y receptor autorizado. Separar política/revocación de entrega de alertas.

Aceptación:
- Reuso, binding inválido y exceso de grants tienen pruebas; 500 de infraestructura no incrementa contadores de abuso.
- Revocación afecta al principal correcto y hace fallar siguientes accesos; no deshabilita indiscriminadamente una oficina compartida por un fallo individual.
- Alerta durable deduplicada, sin secretos y con entrega/reintento observable. Umbrales y recuperación quedan registrados, sin inventar valores como decisión del cliente.

Verificación: suite vault/device con tráfico sintético concurrente y caída del destinatario; sin envíos reales en tests. Archivos: vault, dispositivo si corresponde, comunicación y tests, en PRs separados.

Checkpoint C (E1-07…10, en dos cortes): primero auditoría/retención; después claves/abuso. No cerrar SEC-09 solo porque grant/redeem pasa.

### E1-11 — Remates de perfiles, turnos y breaks (S/M por brecha; E1-00/04)

Trabajo: mapear OPS-01…06 y SEC-05/06 a pruebas actuales. Abrir un slice únicamente por criterio ausente: versionado/auditoría de perfiles, historial paginado, overrides o carreras de sesión.

Aceptación:
- Relevo `[)` a :05 sin 409 espurio; token/heartbeat fuera de rango no revive sesión; overrides aprobados/revocados se reflejan en turno materializado.
- Cierre nocturno cruza día/mes conservando fecha de negocio y cálculo OPS-07; no incluye reglas de cierre de nómina E2. Historial y perfiles respetan cuadrilla/rol.
- Break único, inicio/fin/autocierre y aviso funcionan con reinicios; parte de OQ-03 relativa a TalkyTimes queda explícita, sin añadir automatización de mensajes de E2.

Verificación: reutilizar `assignments.int.spec.ts`, `shifts-and-crews.int.spec.ts`, `shift-access.int.spec.ts`, checkpoint de reinicio; prueba nueva solo para brecha. Archivos: módulo propietario y su prueba; evidencia por OPS, no un PR masivo.

### E1-12 — Consistencia del semáforo web (M; E1-11/06)

Aceptación:
- Snapshot y eventos no hacen retroceder estado ante duplicados, fuera de orden o reconexión; scope correcto por rol/cuadrilla.
- Caída de heartbeat, break, alerta y relevo se reflejan; la pantalla distingue desconexión de estado fresco.
- Verificar latencia objetivo de realtime (<500 ms según gates existentes) con dos instancias; no confundir entrega del evento con render final.

Verificación: integración realtime existente y navegador real con red interrumpida; teclado, foco y estados distinguibles sin depender solo del color. Archivos: realtime y componentes consumidores por slices. Publicación de semáforo en chat queda fuera salvo decisión expresa.

Checkpoint D (E1-11/12): recorrido operativo completo por roles; conservar WEB-01 y OPS-07, registrar solo delta.

### E1-13 — Canales, identidades y deriva (M por slice; E1-05/07)

Dividir vinculación/validación y escaneo/reportes. Reutilizar registro de canales existente. Membresía manual según ADR 0010: detectar, no invitar/expulsar.

Aceptación:
- Grupos privados asociados a cuadrilla, identidad de bot y mapeos de usuarios/DM validados por vías administrativas auditadas; no asumir que el piloto pobló todos los coordinadores u operadores.
- Escaneo paginado detecta miembros faltantes/sobrantes con vigencia temporal y reporta solo al actor autorizado; PAT de mínimos privilegios.
- Renombrado/desactivación de cuadrilla y mapeo inválido tienen comportamiento explícito y prueba; ninguna tarea modifica membresías automáticamente.

Verificación: fixtures de API para paginación/errores y lectura real autorizada; las pruebas de envío usan destinatarios de ensayo expresamente autorizados. Archivos: communication/client, job y test por slices.

### E1-14 — Programación y alerta urgente (M por slice; E1-13/05)

Trabajo: verificar el dispatcher existente antes de editar. Resolver recurrencia en E1-00; si se mantiene como exigencia, crear slice separado de ocurrencias con timezone, cancelación e idempotencia; no aceptar un campo ignorado.

Aceptación:
- Programación única y cancelación concurrente producen resultado consistente; al entregar se valida destino/scope vigente y no solo el existente al encolar.
- Alerta urgente llega al destinatario definido por ADR 0010; medir p95 <1 s desde petición hasta aceptación remota, incluyendo espera de cola. El polling actual de 1 s debe medirse; no atribuir todo el presupuesto a HTTP.
- Caída remota, timeout y éxito remoto seguido de caída local conservan idempotencia y estados observables; una alerta no se atasca detrás de backlog ordinario.

Verificación: ampliar `communication.int.spec.ts`; ensayo de latencia con tamaño de muestra y carga documentados en canal/DM autorizado. Archivos: communication/outbox/tests, separando recurrencia si aplica.

### E1-15 — Bot y conexión estable (S/M; E1-13/14)

Aceptación:
- Webhook HTTPS estable, secretos fuera del repo, cuenta bot y worker con `agency_worker_runtime`; API y worker arrancan según ADR 0009.
- FAQ aprobadas/versionadas, respuesta en hilo, deduplicación, límite, scope de conocimiento y manejo de desconocidos preservan pruebas existentes.
- Reiniciar API/worker conserva pendientes y respuesta; errores de webhook descartado/entrega son observables sin exponer payloads. Documentar alta, rotación de PAT y recuperación.

Verificación: tests bot existentes y smoke autorizado con servidor real. No ampliar PAT ni enviar mensajes a terceros por el solo hecho de ejecutar el plan. Archivos: configuración/runbook y ajustes mínimos que el smoke revele.

Checkpoint E (E1-13…15): bot, aviso y alerta demostrados; deuda E0 clasificada y requisitos E1 cubiertos.

### E1-16 — Seguridad del despliegue (M; E1-06/08/09/10/12/15; CIDR/entorno reales)

Aceptación:
- IP de oficina y proxy reales, rechazo de X-Forwarded-For falsificado, HTTP/WS/rutas públicas protegidos; health mantiene única excepción prevista.
- Cinco roles, DB runtime no propietario, worker de mínimos privilegios, cookies/CORS/secretos y flags fuera-E1 verificados en entorno objetivo.
- Suite de seguridad y revisión de dependencias/logs sin hallazgos bloqueantes; runbook explica recuperación de acceso administrativo sin abrir allowlist global.

Verificación: suite QUA-01 y pruebas HTTP/WS desde IP permitida/no permitida. Parámetros secretos por canal seguro; evidencia solo IDs/configuración sanitizada. Archivos: deploy/config/runbook y tests de seguridad si faltan.

### E1-17 — Carga en hardware objetivo (S; E1-16; tamaño de cuadrilla)

Aceptación:
- Carga representa login de relevo, refresh, heartbeats, semáforo, mensajes y jobs E1 concurrentes; declarar usuarios, ocho perfiles por operador si es la capacidad acordada, duración y ramp-up.
- Registrar p95/p99, errores, memoria pico, CPU, pool DB, backlog y latencias de E1-12/14; sin OOM ni crecimiento sostenido de cola.
- Mantener scrypt configurado por defecto hasta medir. No rebajar coste automáticamente; si no cabe, documentar capacidad/seguridad y alternativa antes de cambiar parámetro.

Verificación: entorno de capacidad contratada (incluido 1 GB si se mantiene); distinguir carga sintética backend de la RAM/cookies del E2E físico. Entregable: informe con límites aceptados, no un número de capacidad inventado.

### E1-18 — HA, restore y rollback (M por ensayo; E1-17; infraestructura contratada)

Aceptación:
- Retirar una API y desplegar sucesivamente no pierde operación; worker recupera; failover real de PostgreSQL y Redis documentado.
- Restore aislado/PITR con claves recupera datos y permite operación sintética. Medir RPO ≤5 min y RTO objetivo ≤30 min según ADR 0009; no sustituir medición con disponibilidad declarada del proveedor.
- Imagen anterior y migraciones compatibles permiten rollback; no bajar schema destructivamente ni borrar datos para volver. Rotación de claves/retención requiere procedimiento propio de recuperación.

Verificación: game day autorizado con cronología, checks de integridad, comparación antes/después y tiempos. No ejecutar fallos destructivos en entorno compartido de forma implícita. La prueba local existente se reutiliza como preparación, no como certificación HA.

### E1-19 — Candidato y aceptación (S; E1-18 + INT-01 para cierre final)

Aceptación:
- CI verde sobre commit exacto; matriz/catálogo/checklists/OpenAPI/runbooks consistentes; evidencia por cada gate y revisión del diff final.
- Recorrido de aceptación: acceso por roles/IP, asignación, apertura mediante estación, turno/break/relevo, semáforo, ayuda y alerta, recuperación. Credenciales no aparecen en UI/logs/artefactos; conservar riesgo residual de DevTools ya aceptado, sin prometer protección contra operador técnico.
- Acta distingue aprobado, pendiente y excepción aceptada por la clienta. INT-01 y contingencia comercial no se dan por cumplidas con mocks ni por terminar el backend.

Verificación: demostrar al responsable de aceptación con cuentas autorizadas; adjuntar versión desplegada, capacitación breve y contactos/procedimientos de soporte. No enviar acta ni solicitar cuota automáticamente.

## 7. Entradas externas y decisiones

| Entrada | Responsable | Necesaria antes de | Mientras falta |
|---|---|---|---|
| CIDR proxy/oficina, dominio y entorno contratado | Daniel/proveedor/operación | E1-16 | Probar con infraestructura aislada y marcar gate externo. |
| Retención audit OQ-08 | Clienta, propuesta de Daniel | Activar borrado E1-08 | Mantener 0=conservar todo; medir crecimiento. |
| Reglas pendientes de breaks OQ-03 | Clienta/coordinación | Cerrar criterio afectado E1-11 | Mantener flujo aprobado; separar automatización TalkyTimes. |
| Recurrencia y semáforo en chat | Daniel coteja fuentes; clienta si queda ambigüedad | Ampliación E1-14/12 | Programación única y semáforo web como baseline. |
| Identidades/DM y destinatarios de ensayo | Administrador Rocket.Chat | E1-13/14/15 | Mocks y lecturas; no enviar a personas no autorizadas. |
| Cuadrilla concurrente y hardware | Operación/Daniel | E1-17 | Preparar escenarios parametrizados, sin afirmar capacidad. |
| PC/credenciales y ocho perfiles autorizados | Operación/clienta | INT-01/E1-19 | Cerrar software verificable; conservar bloqueo físico. |
| Ventana de game day y entorno de restore | Daniel/proveedor | E1-18 | Preparar procedimiento y ensayo local. |

No estimar fechas contractuales nuevas sin resolver estas entradas. Los tamaños S/M son unidades de implementación, no promesas de duración; recalibrar al cerrar E1-00. Ejecutar una sola tarea de construcción por vez en superficies compartidas.

## 8. Comandos y gates

Comandos existentes en `package.json`, no ejecutados durante esta planificación:

| Uso | Comando |
|---|---|
| Trazabilidad documental | `pnpm test:requirements` |
| Guard | `pnpm --dir backend exec vitest run src/common/auth/guards.spec.ts` |
| Cliente | `pnpm --dir web-app test src/services/api-client.test.ts` |
| Integración focal de comunicación | `pnpm --dir backend exec vitest run --config vitest.integration.config.ts src/test/integration/communication.int.spec.ts` |
| Calidad global | `pnpm ci:quality` |
| Integración global | `pnpm test:integration` |
| Candidato completo | `pnpm ci:verify` |

Antes de integración, comprobar URLs y aislamiento de la BD. `ci:verify` ejecuta calidad y después `ci:database` con `NODE_ENV=test` y `TEST_DB_RECREATE=1`; `ci:database` incluye migraciones y seed. Inspeccionar configuración antes de ejecutarlo: no es un chequeo de solo lectura ni debe apuntar a producción. Usar base desechable y cuentas sintéticas.

Pruebas de navegador se ejecutan en los cambios de UI y aceptación, con consola/red y evidencias sanitizadas. Los comandos focales de nuevos tests se registran al crearlos, sin inventar nombres como si ya existieran.

## 9. Riesgos y criterios para detener rollout

| Riesgo | Prevención/evidencia |
|---|---|
| Cerrar casillas por código existente | E1-00 obliga a aceptación y ejecución nombrada. |
| Duplicar envíos tras fallo remoto | Idempotencia estable, prueba de ventana ambigua y estado visible; no garantía absoluta no probada. |
| Recuperación de jobs altera tiempo liquidado | Cierre al borde de negocio y regresión de OPS-07 tras caída. |
| Mover jobs rompe permisos | Probar cada job con rol runtime; no ensanchar worker por comodidad. |
| Cambiar KEK inutiliza vault/backups | Reenvoltura y restore antes de sustituir clave; conservar versiones requeridas. |
| Retención elimina evidencia útil | Decisión explícita y ensayo aislado antes de habilitar eliminación. |
| Alta disponibilidad solo en papel | Game day real con RPO/RTO medidos. |

Rollout propuesto: candidato en staging → smoke y gates → piloto autorizado acotado → expansión tras revisión de métricas. No requiere crear flags nuevos; conservar los existentes fuera de E1 apagados. Definir ventana de observación que cubra al menos un relevo real y responsables antes de desplegar.

Detener expansión ante fuga de datos, acceso fuera de scope/turno, pérdida de eventos, corrupción de tiempos, OOM o incumplimiento sostenido de latencias. Recuperar con imagen anterior compatible, detener el job afectado cuando sea seguro y preservar evidencia; no restaurar BD sobre datos recientes sin evaluar pérdida. Daniel registra incidente y decide recuperación; comunicaciones externas requieren autorización.

## 10. Checklist de seguimiento

- [ ] E1-00 Alcance/evidencia reconciliados.
- [ ] E1-01 SEC-11 cerrado.
- [ ] E1-02 Restauración web recuperable. Checkpoint A.
- [ ] E1-03 Contrato de recuperación aprobado técnicamente.
- [ ] E1-04a Persistencia/claim.
- [ ] E1-04b Materialización/cierre.
- [ ] E1-04c Reaper/avisos/particiones.
- [ ] E1-05a Consulta/reproceso outbox.
- [ ] E1-05b Métricas/fallos parciales.
- [ ] E1-06 Checkpoint 3. Checkpoint B.
- [ ] E1-07a Catálogo/sanitización audit.
- [ ] E1-07b Atomicidad de mutaciones.
- [ ] E1-08 Política/consulta/retención.
- [ ] E1-09a Concurrencia de claves.
- [ ] E1-09b Recifrado reanudable.
- [ ] E1-09c KEK/restore.
- [ ] E1-10 Abuso/revocación/alerta. Checkpoint C.
- [ ] E1-11 Remates operativos con evidencia por OPS.
- [ ] E1-12 Realtime web. Checkpoint D.
- [ ] E1-13 Vinculación/deriva chat.
- [ ] E1-14 Programación/urgencias; recurrencia resuelta en alcance.
- [ ] E1-15 Bot permanente. Checkpoint E.
- [ ] E1-16 Gate de seguridad del entorno.
- [ ] E1-17 Capacidad medida.
- [ ] E1-18 HA/restore/rollback.
- [ ] INT-01 Gate físico aprobado (ejecución independiente).
- [ ] E1-19 Acta/evidencia/candidato final.

Primera acción de ejecución: E1-00, seguida de E1-01. Primer bloque de construcción transversal: E1-03/04. E1-07 puede adelantarse para desbloquear el reproceso auditado de E1-05. No marcar esta lista por haber redactado el plan.
