# Plan de análisis de la API de Tableau y ETL de Agency OS

**Fecha:** 2026-08-17  
**Estado:** discovery dinámico completado para el sitio `partnerdata`; Revenue detailed resuelto por el catálogo de vistas del sitio; contrato temporal para puntos y zona horaria aún pendiente.  
**Alcance:** Tableau Cloud de la clienta, inventario de workbooks/vistas, validación de filtros y granularidad, diseño e implementación del ETL con cadencia por vista.

## 1. Objetivo

Construir una integración que descargue los datos necesarios de Tableau, los valide y los almacene en PostgreSQL para que Agency OS consuma siempre la copia local.

El ETL no debe depender de una lectura en vivo de Tableau desde el dashboard del usuario. Debe producir cargas reproducibles, auditables e idempotentes, conservando la diferencia entre:

- la fecha/hora del dato en Tableau;
- la fecha/hora de actualización declarada por Tableau;
- la fecha/hora en que Agency OS hizo la extracción;
- la fecha de negocio usada para nómina y reportes internos.

## 2. Fuentes y evidencia

### 2.1 Presentación funcional

La presentación [Guía de uso inicial — Tableau 2026](https://www.canva.com/design/DAHByry9hzw/nRo6kbpTRFeTRGg4bXVhaQ/view?utm_content=DAHByry9hzw&utm_campaign=designshare&utm_medium=link&utm_source=viewer) confirma:

- vistas de ingresos, actividad, sesiones, velocidad de respuesta, retención, SourceID, rompehielos y Travel Misleading;
- filtros comunes como fecha, zona horaria, SourceID, `id_trusted user` y `Revenue type`;
- reportes horarios, diarios y cada tercer día;
- existencia de una vista de puntos con granularidad horaria, según la información de la clienta registrada en `agents.md` y `backend/PLAN.md`;
- descarga manual en Crosstab Excel/CSV.

La presentación no confirma los nombres técnicos de columnas, el límite de filas, la sintaxis exacta de rangos de fecha ni la estructura de cada vista.

### 2.2 Documentación oficial de Tableau

El procedimiento de autenticación y consulta se basa en la documentación oficial:

- [Sign in / autenticación de Tableau REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm)
- [Workbooks and views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm)
- [REST API reference](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref.htm)

La documentación consultada confirma:

1. El PAT se usa para `POST /api/{version}/auth/signin`.
2. La respuesta devuelve un token temporal de autenticación, el `siteId` y el `contentUrl`.
3. Las llamadas posteriores usan `X-Tableau-Auth` con el token temporal, no con el secreto del PAT.
4. Los workbooks soportan paginación; la documentación indica un máximo de 1000 elementos por página.
5. Las vistas pueden enumerarse por workbook.
6. `GET /sites/{site-id}/views/{view-id}/data` devuelve CSV.
7. La consulta de datos acepta `maxAge` y filtros `vf_<fieldname>=<value>`.
8. Tableau Cloud documenta un límite de 20 solicitudes concurrentes para la consulta de datos; el cliente debe reintentar con backoff cuando reciba `429`.
9. La descarga de crosstab devuelve datos de resumen; no debe asumirse que siempre contiene el detalle completo de la vista.
10. La documentación oficial de filtros `vf_` no admite rangos, comodines ni desigualdades; solo valores exactos o listas de valores. La ventana temporal debe recortarse localmente.
11. El catálogo de vistas del sitio (`GET /sites/{site-id}/views`) puede ser necesario además de enumerar vistas por workbook; el discovery real encontró Revenue detailed por esta ruta.

### 2.3 Video compartido por la clienta

Se revisó el video [Cómo conectar una API a Tableau — Guía 2025](https://youtu.be/ryhWm8lTrlo?si=2qXVaM5Aqjc_-73E). El flujo que se ve en pantalla es el de **Tableau Desktop/Public → Connect → Installed Connectors → Web Data Connector**:

1. Abrir el conector de datos web desde la pantalla de conexión.
2. Pegar en `Paste URL here` la URL del conector.
3. Seguir la página o autenticación que el conector presente, si la solicita.
4. Esperar a que el conector recupere los datos y los importe como un extracto.
5. Continuar el análisis cuando Tableau abra una hoja de trabajo.

La demostración visible corresponde a un **Web Data Connector (WDC)** y no muestra el flujo server-side que necesita Agency OS: `POST /auth/signin` con PAT, token temporal en `X-Tableau-Auth` y descarga de `/views/{view-id}/data`. La descripción del video menciona Postman y varias APIs de Tableau, pero no hay evidencia suficiente en el flujo visual revisado para sustituir la documentación oficial ni para asumir una sintaxis de autenticación distinta.

| Ruta | Uso | Decisión para Agency OS |
|---|---|---|
| WDC en Tableau Desktop | Conexión manual desde la interfaz de Tableau y creación de un extracto local | No es el mecanismo principal del ETL; evaluarlo solo si la clienta necesita un conector para usuarios de Tableau Desktop |
| REST API desde el worker | Extracción automática, auditable y programada hacia PostgreSQL | Mantener como mecanismo del ETL: PAT → token temporal → CSV/crosstab → staging → hechos normalizados |

Por tanto, el video confirma el concepto de que Tableau puede consumir una URL de datos mediante un conector, pero no modifica la arquitectura acordada ni elimina la necesidad de validar el acceso PAT y las vistas reales de la cuenta de la clienta.

### 2.4 Video de Postman: flujo de autenticación REST

El segundo video, [Cómo configurar Postman para la API de Tableau](https://www.youtube.com/watch?v=Jg5zpZQHG1o), sí es directamente útil para el backend. La demostración visible cubre la preparación de Postman y la autenticación contra Tableau REST API:

1. Importar la colección de Tableau REST API en Postman y crear/forkear una copia de trabajo.
2. Crear un **Personal Access Token (PAT)** desde Tableau.
3. Copiar el secreto inmediatamente: Tableau advierte que solo se muestra una vez y desaparece al cerrar el diálogo.
4. Configurar un environment con variables como `server`, `api-version`, `content-url`, `site-id`, `site-name` y credenciales PAT de administrador/usuario.
5. Seleccionar explícitamente el environment antes de ejecutar las peticiones.
6. Ejecutar `Sign in (As an Admin PAT)`.
7. Leer la respuesta `200 OK`, que contiene un token temporal dentro de `credentials`, junto con `site.id`, `site.contentUrl` y la información de expiración.
8. Reutilizar el token temporal en las llamadas posteriores autenticadas.

El video muestra también un fallo instructivo: al no estar seleccionado el environment, Postman deja variables como `{{server}}` sin resolver y la petición falla con un error de DNS (`EBADNAME`). Esto se traduce en una validación obligatoria del cliente: ninguna URL debe construirse con variables vacías o placeholders sin resolver.

#### Traducción del flujo de Postman al worker de Agency OS

| Postman | Implementación prevista |
|---|---|
| PAT name + PAT secret en environment | Secret manager/env seguro; nunca en Git, logs ni `etl_runs` |
| `Sign in (As an Admin PAT)` | `POST /api/{version}/auth/signin` al iniciar o renovar sesión |
| Token de `credentials` | Cache temporal en memoria/Redis con TTL; no persistirlo como dato de negocio |
| `site.id` y `site.contentUrl` de la respuesta | Validar contra el sitio esperado y guardar solo metadata no sensible |
| Header de Postman para llamadas siguientes | `X-Tableau-Auth: <token-temporal>` |
| Peticiones de la colección | Cliente REST tipado, allowlist de endpoints y worker durable |

La colección del video parece usar respuesta XML en la demostración y contiene variables históricas de versión —en los frames se observan valores como `3.20` y una explicación sobre `3.25`—. No copiaremos esos valores sin verificar: el worker debe usar una versión soportada por el Tableau de la clienta, fijada explícitamente en configuración. Para el cliente interno conviene solicitar y parsear JSON de forma explícita, aunque la API también pueda responder XML.

El video demuestra la autenticación y el uso de la colección, pero no llega a validar el endpoint de negocio que necesitamos para el ETL (`GET /sites/{site-id}/views/{view-id}/data`). Por eso el siguiente paso sigue siendo probar, con el PAT real, el inventario de workbooks/vistas y una descarga pequeña de CSV, y después validar filtros, volumen y timezone.

## 3. Estado actual del repositorio

### 3.1 Lo que ya existe

El backend ya contiene un módulo Tableau y tablas de preparación:

- `backend/src/modules/tableau/tableau.controller.ts`
- `backend/src/modules/tableau/tableau.service.ts`
- `backend/src/modules/tableau/tableau.schemas.ts`
- `backend/src/database/schema/domain.ts`
- migraciones con `tableau_views`, `tableau_hourly_points`, `etl_runs` y `etl_staging_rows`

El diseño existente ya apunta a:

- configurar vistas desde base de datos;
- conservar filas crudas en staging;
- guardar checksum del CSV;
- promover puntos horarios a `tableau_hourly_points`;
- hacer upsert por vista, perfil y hora;
- conciliar los puntos de Tableau con los eventos de la extensión.

### 3.2 Brechas que deben corregirse antes de producción

| Brecha | Riesgo | Corrección prevista |
|---|---|---|
| El código espera `TABLEAU_AUTH_TOKEN` ya emitido | No existe flujo seguro de PAT ni rotación clara | Implementar cliente de autenticación PAT y cachear solo el token temporal en memoria/Redis |
| No hay `TABLEAU_PAT_NAME`/`TABLEAU_PAT_SECRET` en la configuración | No se puede iniciar sesión de forma reproducible | Añadir configuración validada, sin valores reales en el repositorio |
| `run()` llama `void this.execute(row.id)` desde el request HTTP | Trabajo perdido al reiniciar, errores fuera de la respuesta y carreras entre instancias | Mover ejecución a worker/job durable con lease e idempotencia |
| El endpoint construye URL con `siteId` y `viewId` configurados manualmente | Puede confundirse UUID de API con content URL de Tableau | Inventariar workbooks/vistas y guardar ambos identificadores explícitamente |
| No hay inventario real de vistas | El ETL no sabe qué descargar ni qué columnas esperar | Fase de discovery contra la cuenta de la clienta |
| No hay filtros `vf_` implementados | Puede descargar demasiado volumen o no poder aislar la ventana horaria | Allowlist de valores exactos/listas; no usar rangos (REST no los soporta) y validar filas localmente |
| Parser CSV propio sin contrato de columnas | Cambios de encabezado, BOM, nulos o columnas duplicadas pueden corromper datos | Parser robusto + schema por vista + fingerprint de encabezados |
| Consulta de perfil por cada fila | N+1 contra PostgreSQL | Resolver perfiles en lote mediante mapa por ID externo/clave normalizada |
| No se conserva el artefacto fuente completo | No se puede reprocesar exactamente una extracción | Guardar archivo crudo en almacenamiento privado o una política explícita de retención |
| No hay timeout de tamaño ni límites de filas | Un crosstab grande puede agotar memoria | Streaming/limites, tamaño máximo, métricas de bytes y filas |
| La vista `/data` devuelve `406` cuando se envía `Accept: text/csv` | El worker actual puede fallar aunque la vista y el PAT sean válidos | Enviar `Accept: application/json` o no fijar `Accept`; validar que la respuesta efectiva sea `text/csv` |
| No hay reintentos ni manejo especial de `429` | Fallos intermitentes dejan cargas parciales | Backoff exponencial, jitter, máximo de intentos y estado `RETRYING` |
| La unicidad se verifica primero en aplicación | Dos instancias pueden crear dos ejecuciones | Constraint/insert atómico y lease en base de datos |
| `sourceTimezone` default `America/Bogota` | Puede atribuir una hora al turno incorrecto | Mantener timezone por vista, obtener evidencia real y no asumir Bogotá |

## 4. Manejo seguro del PAT

El PAT no debe escribirse en el chat, en un archivo rastreado ni en logs.

Variables previstas para el entorno local/worker:

```text
TABLEAU_API_BASE_URL=https://prod-uk-a.online.tableau.com
TABLEAU_API_VERSION=3.29
TABLEAU_SITE_CONTENT_URL=partnerdata
TABLEAU_PAT_NAME=<secreto-local>
TABLEAU_PAT_SECRET=<secreto-local>
```

Notas:

- `TABLEAU_PAT_NAME` y `TABLEAU_PAT_SECRET` solo se envían al endpoint de `signin`.
- El worker debe descartar el secreto del PAT después de autenticarse y conservar únicamente el token temporal en memoria o en un almacén de secretos con TTL corto.
- Nunca se debe guardar el token temporal en `etl_runs`, `audit_log`, `rawRow`, checksum, mensajes de error o métricas.
- Los logs solo pueden mostrar host, site content URL, versión de API, vista, estado HTTP, duración, bytes, filas y un identificador de ejecución.
- Si un PAT ya fue pegado en un canal inseguro, debe revocarse y emitirse uno nuevo antes de usarlo.

## 5. Protocolo de validación en vivo

El objetivo de esta fase es medir la fuente real con consultas pequeñas y controladas. No se debe empezar descargando todos los reportes ni ejecutar una prueba de carga contra Tableau Cloud.

### Paso 0 — acceso y smoke test

**Entrada:** PAT, `contentUrl` del sitio y host de Tableau Cloud.

**Prueba:**

1. `POST /api/3.29/auth/signin` con PAT y `site.contentUrl`.
2. Verificar HTTP 200.
3. Guardar solo en memoria el token temporal, `site.id`, `site.contentUrl`, `user.id` y `estimatedTimeToExpiration` si viene en la respuesta.
4. Ejecutar una llamada `GET` autenticada pequeña.
5. Revocar/cerrar la sesión al terminar el conjunto de pruebas si el endpoint de sign-out se incorpora al cliente.

**Criterios de aceptación:**

- El PAT tiene permisos de lectura sobre el sitio y las vistas requeridas.
- El `contentUrl` devuelto coincide con el sitio esperado.
- El token temporal no aparece en logs ni archivos de trabajo.
- Un `401` produce un error seguro y accionable, sin revelar el secreto.

**Resultado ejecutado el 2026-08-17:** el `signin` respondió `200` con API `3.29` y sitio `partnerdata`; el catálogo paginado devolvió **18 workbooks**, **44 vistas por workbook** y **86 vistas a nivel de sitio**. El token temporal y el secreto no se imprimieron ni se guardaron.

Revenue detailed se resolvió en el catálogo de vistas del sitio con workbook content URL `Passport_16741406948180`, view content URL `Passport_16741406948180/sheets/Revenuedetailed` y view LUID `0886ff29-117e-4e3f-b11a-6dafde449803`. La descarga sin `Accept` respondió `200`, `Content-Type: text/csv`, **373184 bytes** y **1528 filas**. Enviar `Accept: text/csv` respondió `406 Not Acceptable` con HTML.

El CSV expone nueve columnas (`Admin`, `ID Trusted User`, `Max Hour`, `Revenue type`, dos títulos de servicio, `source ID`, `source_ID_alert`, `Revenue`) y no contiene una fecha/hora de evento; `Max Hour` aparece constante. La expansión visual de `ID Trusted User` en el dashboard no cambia lo que devuelve el endpoint REST: `/data` y el crosstab son exportaciones de resumen. Debe conservarse como resumen de revenue y no usarse para atribución del día operativo ni de nómina.

**Seguimiento de la expansión (2026-08-17):** el catálogo también contiene `Revenue detailed (SourceID)`
(`viewId` `5af593e6-1a3a-4661-b10b-26467ba4e287`). Su CSV respondió `200` con **1.539 filas** y
las columnas `Date aggregated`, `id trusted user`, `Max Hour`, servicios, `SourceID`, diferencia y
`Revenue`; `Date aggregated` tiene nueve valores semanales y `Max Hour` es `20` en todas las filas.
Su crosstab Excel respondió `200`, pero conserva ese nivel semanal. La evidencia de CSV/crosstab está
en `tasks/evidence/tableau/2026-08-17T20-57-22-536Z/` y los archivos crudos sensibles están bajo
`.local/tableau/` ignorado por Git.

### Paso 1 — inventario de workbooks y vistas

1. Enumerar `GET /sites/{siteId}/workbooks?pageNumber=N&pageSize=...` hasta completar `totalAvailable`.
2. Guardar localmente el inventario no sensible: workbook ID, nombre, `contentUrl`, proyecto, `updatedAt`, propietario y URL visible.
3. Para cada workbook relevante, consultar sus vistas.
4. Consultar también `GET /sites/{site-id}/views` y deduplicar por LUID; una vista puede ser visible allí aunque la búsqueda por workbook no la devuelva.
5. Relacionar las URLs de la presentación con `workbook contentUrl`, `view contentUrl`, nombre visible y UUID de API.
6. Marcar vistas con permiso insuficiente, vistas duplicadas y enlaces rotos.

**Resultado:** inventario sanitizado versionado en `tasks/evidence/tableau/` y respuestas raw en `.local/tableau/`, ignoradas por Git. El último inventario tiene 18 workbooks y 86 vistas.

**No se debe asumir:** que el último segmento de una URL pública es el `viewId` UUID requerido por todos los endpoints de la REST API.

### Paso 2 — ficha de cada vista candidata

Para cada vista candidata se debe registrar:

- categoría funcional;
- workbook y view;
- UUID de workbook y UUID de vista;
- content URL;
- frecuencia de actualización declarada por la clienta;
- columnas observadas;
- tipos inferidos;
- valores nulos;
- número de filas;
- rango temporal cubierto;
- timezone de las marcas de tiempo;
- filtros disponibles;
- tamaño de respuesta CSV y crosstab;
- tiempo de respuesta;
- checksum del artefacto;
- resultado de validación.

Vistas prioritarias para el primer ciclo:

1. vista de puntos por hora, si existe y tiene granularidad por perfil;
2. Revenue detailed;
3. Online sessions;
4. Answer speed;
5. TU activity;
6. Passport;
7. Chat icebreakers/conversion;
8. Connections retention.

### Paso 3 — prueba de datos y crosstab

Para cada vista prioritaria:

1. Descargar una ventana pequeña de datos mediante `/data` y guardar CSV crudo temporalmente.
2. Descargar el crosstab solo cuando sea necesario para comparar resumen y detalle.
3. Comparar encabezados, filas y totales.
4. Medir `bytes`, `rowCount`, `durationMs`, `statusCode` y `maxAge` efectivo.
5. Repetir una consulta con el mismo filtro para comprobar estabilidad e idempotencia.

Se debe distinguir entre:

- vista de dashboard;
- worksheet subyacente;
- vista de resumen;
- vista con detalle por fila.

Si `/data` devuelve únicamente datos agregados, esa vista no es suficiente para nómina o atribución por operador aunque visualmente muestre un gráfico correcto.

**Muestra real ejecutada con el PAT:**

| Vista | Tamaño | Líneas aproximadas | Primeras columnas observadas |
|---|---:|---:|---|
| Chat posts send | 170 KB | 2.459 | `date send post`, `date spend`, `ID Trusted user`, `id_regular_user`, `source ID` |
| Chat post convertion dashboard | 9 KB | 126 | `ID Trusted user`, `id_agency`, `id_agency_main`, `Conversion %`, `Posts per Connection`, `revenue` |
| Ices with photo | 57 KB | 953 | fecha de creación, tipo de ice, foto, convertidos, cantidad y conversiones |
| Chat request | 23 KB | 638 | fecha, tipo de mensaje, porcentajes de conversión y mensajes |
| TOP connection | 11 KB | 106 | fecha, agencia, conexión, RU, TU, límites y métricas |
| Video Calls TU metrics | 2,5 KB | 49 | agencia, `ID TU`, nombre de medida y valor de medida |
| Video Calls TU metrics daily | 172 KB | 2.273 | fecha UTC, agencia, `ID TU`, nombre de medida y valor de medida |
| Video calls TU efficiency daily | 172 KB | 2.273 | misma estructura que la vista anterior |
| Scoring board | 84 bytes | 2 | devuelve una instrucción de filtro, no datos útiles sin seleccionar `id agency main` |
| Chat request content | 3,0 MB | 13.264 | agencia, `id agency main`, mensaje y métricas |
| VIP Contacts Usage | 1 byte | 1 | respuesta vacía |

El inventario no contiene un workbook separado llamado literalmente `Revenue` o `Points`; Revenue detailed está dentro del workbook técnico `Passport_16741406948180` y solo apareció mediante el catálogo de vistas del sitio. La vista devuelve un resumen por TU/SourceID y tipo de revenue, sin columna temporal. Su vista hermana `Revenue detailed (SourceID)` sí se pudo descargar, pero devuelve **1.539 filas**, nueve valores semanales de `Date aggregated` y `Max Hour=20` constante; tampoco es una fuente horaria. La crosstab de ambas vistas responde `200`, pero sigue siendo resumen. No debe usarse ninguna de las dos para atribuir puntos ni para reconstruir el día operativo hasta que la clienta publique una worksheet plana con una fila por perfil/SourceID y hora.

**Resultado de filtros 2026-08-17:** sobre Revenue detailed, los probes con valores observados y candidatos de la guía devolvieron `200`, pero los campos ausentes o no reconocidos pueden devolver el dataset completo o una respuesta vacía. Un campo inválido deliberado (`__AgencyOSInvalidField`) devolvió las mismas 1528 filas. El cliente debe tratar `vf_` como optimización no confiable y validar el resultado localmente.

### Paso 4 — matriz de filtros `vf_`

La documentación confirma el formato general `vf_<fieldname>=<value>` y especifica que los filtros REST no admiten rangos, comodines ni desigualdades. Las ventanas 06:05–14:05, 14:05–22:05 y 22:05–06:05 se deben reconstruir con filas temporales y el algoritmo 5/55; no se debe esperar una consulta directa por rango.

Se probará una matriz pequeña:

| Prueba | Ejemplo conceptual | Resultado esperado |
|---|---|---|
| Igualdad numérica | `vf_SourceID=123` | Solo filas del SourceID |
| Igualdad textual | `vf_Revenue type=Paid` | Solo el valor solicitado |
| Fecha exacta | `vf_Date=2026-08-13` | Solo la fecha o evidencia de formato rechazado |
| Rango Tableau | No soportado por REST `vf_` | Se descarta como estrategia |
| Perfil | `vf_id_trusted user=<id>` | Solo el perfil seleccionado |
| Valor inexistente | filtro que no existe | Cero filas o error explícito, nunca datos sin filtrar |
| Campo inválido | `vf_NotAField=x` | Error controlado o respuesta sin filas; se documenta el comportamiento |

El gate ya no es probar una sintaxis de rango ni expandir manualmente la tabla: la REST API no expone ese nivel expandido. Solo una worksheet plana con grano horario (o una fuente equivalente autorizada) y control totals puede cerrar `MET-05`.

### Paso 5 — volumen y límites

Las pruebas deben ser progresivas: 1, 2, 4 y 8 solicitudes secuenciales/concurrentes como máximo inicialmente.

Medir:

- filas por ventana de 1 día, 7 días y 30 días;
- bytes descargados;
- tiempo p50/p95;
- memoria máxima del worker;
- comportamiento de `maxAge=1` y `maxAge` mayor;
- respuesta ante `429` y `401`;
- truncamiento o pérdida de encabezados;
- diferencias entre CSV y crosstab.

No hacer una prueba de 20+ solicitudes simultáneas contra producción solo para confirmar el límite. El límite de 20 documentado se usa como techo de diseño, no como objetivo de carga.

### Paso 6 — zona horaria y atribución

Usar una fecha conocida y una vista con puntos horarios:

1. Comparar la marca de tiempo devuelta por Tableau con la zona configurada en el sitio.
2. Comparar el total diario de la vista con la suma de sus filas horarias.
3. Simular los tres relevos de la agencia: 06:05, 14:05 y 22:05.
4. Verificar el cruce de día del turno nocturno.
5. Confirmar si el reporte devuelve fecha de calendario, fecha de inicio de turno o ambas.

Si el filtro directo por ventana no funciona, el ETL conservará la fila horaria y el backend asignará cada hora a la asignación correspondiente. La hora atravesada por un relevo se repartirá por minutos 5/55, según la decisión ya registrada en `agents.md`/`backend/PLAN.md`.

## 6. Diseño objetivo del ETL

### 6.1 Flujo

```text
Scheduler durable
  -> crea ETL run idempotente
  -> autentica con PAT y obtiene token temporal
  -> enumera/lee vista configurada
  -> descarga CSV/crosstab con filtros allowlisted
  -> guarda artefacto + checksum + metadata
  -> valida encabezados, tipos, nulos y volumen
  -> escribe staging
  -> transforma a hechos normalizados
  -> concilia contra carga anterior/extensión
  -> publica snapshot listo para dashboard
  -> emite métricas, alertas y resumen de ejecución
```

### 6.2 Capas de almacenamiento

#### Configuración de vistas

Extender `tableau_views` para conservar, como mínimo:

- `workbook_id` y `workbook_content_url`;
- `view_api_id` y `view_content_url`;
- nombre visible y nombre técnico;
- tipo de dato: `POINTS_HOURLY`, `REVENUE`, `SESSIONS`, `RESPONSE_SPEED`, `RETENTION`, `ICEBREAKERS`, etc.;
- frecuencia esperada;
- timezone de origen;
- filtros allowlisted;
- mapping versionado de columnas;
- schema fingerprint esperado;
- estado activo y fecha de última verificación.

#### Ejecuciones

Extender `etl_runs` para registrar:

- `run_id`;
- vista;
- ventana solicitada;
- `business_date`;
- estado `QUEUED`, `RUNNING`, `RETRYING`, `SUCCESS`, `PARTIAL`, `FAILED`;
- intento actual y máximo;
- started/finished/extracted timestamps;
- HTTP status y código de error normalizado;
- filas, filas rechazadas, bytes, duración;
- checksum y schema fingerprint;
- `source_updated_at` cuando esté disponible;
- mensaje de error sanitizado.

#### Artefacto crudo

Conservar el CSV/XLSX original en almacenamiento privado con retención definida. En PostgreSQL se conserva metadata, checksum, ubicación y tamaño; no se debe llenar el log de aplicación con el archivo.

#### Staging

Mantener filas crudas con:

- encabezado y mapping usado;
- número de fila;
- valores originales;
- validación;
- error por fila;
- run ID;
- hash de la fila si se necesita detectar cambios.

#### Hechos normalizados

Separar hechos por granularidad y propósito:

- `tableau_hourly_points` para puntos horarios por perfil/SourceID;
- revenue por servicio, tipo de crédito, perfil, SourceID y periodo;
- sesiones online por intervalo y SourceID;
- mensajes/respuestas por evento o ventana;
- retención por cohorte/día/tiempo de vida;
- rompehielos por mensaje, TU, categoría y resultado;
- Travel Misleading por conexión, mensaje, TU y tipo.

No se debe mezclar una métrica diaria agregada con un evento horario en la misma tabla solo porque ambos provienen de Tableau.

### 6.3 Idempotencia y reproceso

La clave lógica debe incluir la vista y la ventana de negocio. Para hechos horarios, incluir perfil/SourceID y la hora de origen.

Reglas:

- la misma extracción repetida no duplica datos;
- una nueva extracción del mismo día puede corregir el snapshot mediante upsert controlado;
- no se sobreescribe el artefacto anterior: cada run conserva su checksum;
- la promoción a tablas de hechos ocurre de forma atómica;
- un run `PARTIAL` no se publica como completo;
- un fallo de una vista no invalida silenciosamente las demás vistas del mismo ciclo.

### 6.4 Reintentos y concurrencia

- máximo de 4 intentos por vista salvo intervención manual;
- backoff exponencial con jitter para `429`, `408`, `5xx` y errores de red;
- no reintentar automáticamente `400`, `401`, `403` o `404` sin cambiar configuración/credencial;
- límite interno por debajo del límite de Tableau Cloud, inicialmente 4–8 solicitudes simultáneas;
- timeout separado de conexión, headers y cuerpo;
- límite de bytes y filas por respuesta;
- cancelación limpia al recibir shutdown;
- lease por `run_id` para impedir ejecución doble entre las dos instancias del backend.

### 6.5 Validación de respuesta externa

La respuesta de Tableau debe tratarse como dato externo no confiable:

- validar `Content-Type` y tamaño;
- detectar HTML/error devuelto con HTTP 200;
- rechazar encabezados duplicados o vacíos;
- validar schema por vista;
- normalizar BOM, saltos de línea, separadores y valores nulos;
- parsear fechas con timezone explícita;
- rechazar números no finitos y monedas con formato inesperado;
- limitar longitud de strings antes de persistir;
- conservar la fila cruda para diagnóstico, no el token ni headers sensibles.

## 7. Fases de implementación

### Fase A — discovery y prueba de fuente

**Salida:** inventario de vistas, fichas de esquema y evidencia cruda de consultas pequeñas.

Incluye los pasos 0–6 del protocolo de validación.

**Gate:** no se diseña el mapping definitivo hasta tener una vista real de puntos horarios y una vista real de ingresos.

### Fase B — cliente Tableau seguro

**Salida:** cliente interno con:

- PAT signin;
- token temporal en memoria/TTL;
- sign-out o expiración controlada;
- timeout y límites;
- backoff para `429`/`5xx`;
- allowlist de host y rutas;
- tipos de respuesta;
- logs redacted.

**Gate:** pruebas unitarias de autenticación, expiración, 401, 403, 429, timeout y respuesta malformada.

### Fase C — ETL de puntos horarios

**Salida:** una vista configurada, staging, artefacto, promoción atómica y reconciliación con extensión.

**Gate:** dos ejecuciones iguales no duplican datos; reproceso de un día corregido deja trazabilidad; timezone confirmado; atribución de un relevo reproducible.

### Fase D — ETL de ingresos y operación

Prioridad:

1. Revenue detailed;
2. Online sessions;
3. Answer speed;
4. TU activity/Passport;
5. RU–TU interaction y Connections retention;
6. rompehielos y Travel Misleading.

**Gate:** cada vista tiene schema versionado, mapping, frecuencia, métricas de frescura y dashboard local.

### Fase E — scheduler, observabilidad y operación

**Salida:** jobs durables por vista, con Revenue configurado a las 09:15 `America/Bogota` para el día operativo vencido; dashboard de ejecuciones, alertas, runbook y reproceso manual autorizado.

Debe ser posible responder:

- ¿qué vista falló?
- ¿qué datos faltan?
- ¿hasta qué hora están actualizados?
- ¿qué filas fueron rechazadas?
- ¿qué cambió respecto al checksum anterior?
- ¿qué operador/turno puede verse afectado?

## 8. Criterios de aceptación globales

- [ ] El PAT nunca aparece en Git, logs, respuestas HTTP, staging ni artefactos.
- [ ] El cliente hace signin y usa el token temporal en `X-Tableau-Auth`.
- [ ] El inventario de workbooks y vistas está guardado con UUID y content URL separados.
- [ ] Cada vista activa tiene schema, mapping, timezone, frecuencia y filtros definidos.
- [ ] Se conoce la granularidad real de la vista de puntos.
- [x] Se confirmó por documentación y evidencia que `vf_<campo>` no acepta rangos; las ventanas se recortarán localmente.
- [ ] Se conocen filas, bytes, latencia y comportamiento ante `429` de las vistas prioritarias.
- [ ] El ETL corre fuera de la petición HTTP.
- [ ] Hay ejecución idempotente y segura entre dos instancias.
- [ ] Las respuestas externas se validan antes de tocar tablas de dominio.
- [ ] Cada run conserva checksum, métricas, estado y errores sanitizados.
- [ ] El dashboard lee PostgreSQL y muestra frescura por vista.
- [ ] Se puede reprocesar un artefacto sin volver a consultar Tableau.
- [ ] Se puede conciliar Tableau contra extensión por perfil, hora y fecha de negocio.

## 9. Decisiones que siguen abiertas

1. ¿La clienta tiene una worksheet de puntos horarios por perfil/SourceID ya publicada?
2. ¿Qué worksheet plana de Revenue permite reconstruir el día operativo? La expansión de `ID Trusted User` se ve en UI, pero las exportaciones REST de `Revenue detailed` y `Revenue detailed (SourceID)` son resumen/semana; necesitamos una fila por perfil/SourceID/hora.
3. ¿La zona horaria efectiva de cada vista coincide con UTC+0 de cortes de pago o con otra configuración del workbook?
4. ¿Las columnas y valores de `Revenue type`, `Credits type`, SourceID y TU son estables?
5. ¿Qué vistas deben entrar en la primera entrega y cuáles quedan solo catalogadas?
6. ¿La carga diaria de Revenue a las 09:15 debe bloquear publicación si el último dato disponible no llega a las 06:05?
