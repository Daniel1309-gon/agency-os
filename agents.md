# Agency OS — Contexto para agentes

Este documento existe para que cualquier sesión de Claude Code (o cualquier otro agente) que
trabaje en Agency OS tenga el contexto completo sin tener que reconstruirlo desde cero. No
reemplaza los documentos fuente — los referencia. Si algo de aquí contradice un documento fuente,
gana el documento fuente y este archivo debe corregirse.

---

## 1. Qué es Agency OS y para quién

Agency OS es un sistema de software a medida para la gestión operacional de una agencia de
interacción digital en TalkyTimes (clienta 2, dueña de la agencia — no confundir con la clienta 1,
dueña de JarvisBot, que es su hermana). Resuelve tres problemas de negocio:

1. **Fuga de información** — los operadores acceden hoy directamente a las credenciales de los
   perfiles femeninos de TalkyTimes.
2. **Ineficiencia operativa** — login manual perfil por perfil, nómina en hojas de cálculo,
   comunicación por Discord.
3. **Bajo engagement** — efectividad de icebreakers por debajo del 2%, sin trazabilidad ni
   retroalimentación.

## 2. Objetivo final

Un ecosistema compuesto por: una plataforma web (dashboard de administración, coordinación y
cafetería), una extensión de Chrome + helper local que automatiza el acceso de los operadores a
TalkyTimes sin que vean nunca una contraseña, RocketChat como comunicación interna, y un servicio
de IA aislado que valida y califica los icebreakers que redactan los operadores. El sistema debe
quedar en producción con alta disponibilidad real (backend en 2 instancias, PostgreSQL y Redis en
HA), pensado como inversión a largo plazo — no como un parche.

Alcance, precio y cronograma acordados: **$28.500.000 COP, 6 a 6.5 meses (26 semanas)**, en 3
cuotas (25/35/40%) atadas a hitos. Esto no ha cambiado en ninguna revisión del proyecto — lo que
cambió entre revisiones es *cómo* se construye, no *qué* ni *cuánto cuesta*.

## 3. Documentos de referencia (fuente de verdad)

Todos viven en `C:\Users\danig\Documents\FREELANCE\AGENCIA CAROL\documentos\` (fuera de este repo,
en el directorio de trabajo adicional de Freelance) **excepto** la adenda de reasignación de fases
y los dos informes de viabilidad, que siguen en el repo de JarvisBot
(`C:\Users\danig\Documents\jarvisbot\jarvisbot-main\agency-os\`) porque solo `agents.md` se movió a
esta ubicación — ver nota en §3.1.

- **Documento de requerimientos** — [`agency-os-requerimientos.md`](../../FREELANCE/AGENCIA%20CAROL/documentos/agency-os-requerimientos.md)
  Versión 2.2 (agosto 2026), es la especificación funcional completa (FR-01 a FR-39), arquitectura,
  stack, plan de entrega y estimación de infraestructura. Es el documento más vivo — se actualiza
  cuando cambian decisiones de arquitectura.
- **Propuesta final / comercial** — [`agency-os-propuesta-final.pdf`](../../FREELANCE/AGENCIA%20CAROL/documentos/agency-os-propuesta-final.pdf)
  (idéntico byte a byte a la copia en [`agency-os-propuesta-final.pdf`](../../jarvisbot/jarvisbot-main/agency-os/agency-os-propuesta-final.pdf)
  del repo de JarvisBot, verificado 2026-07-29) y su versión en Markdown más reciente
  [`agency-os-propuesta-comercial-v3.md`](../../FREELANCE/AGENCIA%20CAROL/documentos/agency-os-propuesta-comercial-v3.md)
  (v3.0, julio 2026): resumen ejecutivo, alcance, honorarios, esquema de pagos, Feature #9 y costos
  de infraestructura para el cliente.
- **Adenda de reasignación de fases** — [`agency-os-reasignacion-fases.md`](../../jarvisbot/jarvisbot-main/agency-os/agency-os-reasignacion-fases.md)
  (en el repo de JarvisBot, no en este). Documenta el cambio de stack de automatización y backend
  (§5 de este archivo) y su justificación económica. Su §11 es nota interna, no para el cliente.
- **Informes de viabilidad de reutilizar JarvisBot** —
  [`informe-viabilidad-reutilizacion-jarvis.md`](../../jarvisbot/jarvisbot-main/agency-os/informe-viabilidad-reutilizacion-jarvis.md)
  (versión para la clienta) e [`informe-construccion-desde-cero.md`](../../jarvisbot/jarvisbot-main/agency-os/informe-construccion-desde-cero.md)
  (nota interna con citas de código exactas, no enviar al cliente, en el repo de JarvisBot).
  Sustentan la decisión de §4.
- **Integraciones documentadas** — [`integraciones/`](../../jarvisbot/jarvisbot-main/agency-os/integraciones/)
  en el repo de JarvisBot (TalkyTimes, extensión de Chrome, Tableau, RocketChat, tiempo real,
  terceros/correo/IA). Escritas por subagentes citando archivo y línea del código de JarvisBot; solo
  una parte fue verificada personalmente línea por línea (ver informe-construccion-desde-cero.md
  §8) — verificar contra el código antes de apoyar en ellas una decisión nueva.

### 3.1 Nota sobre versiones duplicadas

`agency-os-requerimientos.md` existe en dos lugares con contenido **distinto**: la copia en el repo
de JarvisBot ([`jarvisbot-main/agency-os/agency-os-requerimientos.md`](../../jarvisbot/jarvisbot-main/agency-os/agency-os-requerimientos.md))
quedó congelada en la v2.0 (Electron + Playwright, sin RocketChat separado). La de
`AGENCIA CAROL/documentos/` es la **v2.2 (agosto 2026)** vigente, ya con la extensión de Chrome,
RocketChat aparte y scrypt en lugar de bcrypt (decisión #19).
Si se va a citar o modificar el documento de requerimientos, es la de `AGENCIA CAROL/documentos/`.
Vale la pena sincronizar o eliminar la copia vieja del repo de JarvisBot para evitar que un agente
futuro lea la versión equivocada.

## 4. JarvisBot como referencia de diseño (no como cimiento)

JarvisBot es el sistema de la clienta 1 (hermana de la clienta 2), vive en un repo aparte
(`C:\Users\danig\Documents\jarvisbot\jarvisbot-main\`, no en este), y resuelve un negocio muy
similar (gestión de operadoras, perfiles, nómina por puntos, TalkyTimes).
Se auditó como alternativa a construir Agency OS desde cero — **la conclusión fue no adaptarlo**.
Razón principal: la agencia, sus clientes y productos (Kasumi, Don César, KBU, SIC Coin, Hobbit)
están hardcodeados en 55 archivos; el sistema nunca se diseñó multi-agencia, y la auditoría técnica
calificó ese escenario como viabilidad baja hoy. Además no tiene control de versiones, no tiene
tests de backend, y tiene vulnerabilidades de credenciales en texto plano (ver §4 de
`informe-viabilidad-reutilizacion-jarvis.md`).

**Cuando sea necesario, se puede tomar como referencia la lógica ya validada en JarvisBot**, sin
portar su código:

- **Nómina por puntos** — conversión puntos → COP con comisión configurable por operadora, metas y
  exportación a Excel. Cubre FR-28 a FR-31.
- **Integración con Tableau** — dashboard de métricas leyendo de Tableau Cloud sin que las
  operadoras entren a Tableau. Cubre FR-18/FR-19. **Investigado (2026-07-29):** la colección
  `Tableau APIs.postman_collection.json` es la API REST oficial de Tableau Server/Cloud (727
  endpoints). Los relevantes para consulta de datos son:
  - `GET /sites/{site-id}/views/{view-id}/data` → devuelve CSV (o formato crosstab)
  - `GET /sites/{site-id}/views/{view-id}/crosstab/excel` → devuelve Excel
  - Query params: `vf_<fieldname>=<value>` (filtros por campo), `maxAge=<minutes>` (caché, mínimo 1 min)
  - Autenticación: header `X-Tableau-Auth` con API key
  - **Limitación crítica no resuelta:** la colección Postman no documenta límite de filas por
    respuesta, paginación, timeout, ni tamaño máximo; no está claro si devuelve datos completos de
    una sola consulta (asume rendimiento/memoria de navegador si es front-end). **Requerido:** antes
    de diseñar el modelo de datos, confirmar (1) que el sitio Tableau del cliente tiene workbooks
    con nómina/puntos/métricas/icebreakers a nivel fila (no solo dashboard agregado), (2) si la API
    puede servir decenas de miles de filas sin timeout o truncamiento, (3) latencia real en
    producción — ver §6.
- **RocketChat como chat interno** — JarvisBot ya demuestra en producción que RocketChat se puede
  desplegar como pieza independiente con autorización propia por rol. Es la base de la Entrega 0.
- **Modelo de datos de perfiles y asignación** — qué pasa cuando una operadora entra a un perfil
  que otra dejó abierto, ya resuelto en la práctica.
- **Mapa de la API interna de TalkyTimes** (`McpClient.php`, `TtBriefingService.php`) — usado solo
  como mapa de qué datos existen en la plataforma para diseñar el modelo de datos propio, y como
  fuente del hallazgo de que TalkyTimes sostiene sesiones concurrentes por perfil de forma nativa
  (retira lo que se consideraba el mayor riesgo técnico del proyecto). **Agency OS no se construye
  sobre esa API** — no está documentada, es ingeniería inversa, y el propio código de JarvisBot
  tiene un mecanismo de "recaptura" que confiesa que la integración se rompe de forma recurrente.
- **Precedente de auto-login que falló al escalar** — `resources/extension/content.js:8851`
  desactiva el auto-login automático de JarvisBot para otra plataforma (AmoLatina) porque fallaba
  con múltiples perfiles por operadora. Es la razón de que Agency OS use inyección de credencial +
  clic manual del operador, no login 100% automático. Salvedad: ese precedente es de AmoLatina, no
  de TalkyTimes — vale como advertencia de patrón, no como límite comprobado de TalkyTimes.

## 5. Decisiones técnicas tomadas (orden cronológico de razonamiento)

| # | Decisión | Reemplaza | Por qué |
|---|---|---|---|
| 1 | Automatización de sesión = **extensión de Chrome (inyecta credencial vía JS, sin portapapeles) + helper local liviano** | Electron + Playwright | El campo de contraseña de TalkyTimes bloquea copy-paste (confirmado por prueba directa); un clic real del operador en el paso sensible reduce la superficie de detección frente a automatizar también el clic |
| 2 | Aislamiento de sesión = **perfiles nativos de Chrome** (`--profile-directory`) | `BrowserContext` de Playwright | Misma garantía de aislamiento sin depender de Playwright. Incógnito queda **descartado**: todas las ventanas de incógnito de una instancia comparten cookies |
| 3 | Concurrencia multi-perfil confirmada como **hecho de la plataforma**: TalkyTimes no ata una cuenta a un navegador, su auth es una petición HTTP que devuelve cookie de sesión sostenible por perfil | — | Retira el riesgo técnico que se consideraba mayor del proyecto. El spike ya no necesita validar esto, solo el lado del navegador/oficina |
| 4 | **No construir sobre la API interna de TalkyTimes** usada por JarvisBot (`McpClient.php`) | — | No es un producto documentado ni autorizado (ingeniería inversa); su propio mecanismo de "recapture" confiesa que se rompe seguido. Riesgo de continuidad (sin duración comprometible por contrato) y riesgo de negocio (exponer las cuentas de la agencia) |
| 5 | **RocketChat** como componente aparte, en VPS propio del cliente (Entrega 0, semanas 1–5/1–3 según versión del documento) | Chat interno desarrollado desde cero | Ya existe, es open source, y hay patrón de integración probado (autenticación por rol) en JarvisBot |
| 6 | Backend principal = **NestJS sobre adaptador Fastify** (`@nestjs/platform-fastify`) | Node.js + Fastify "plano" | Modularidad forzada por el framework — evita repetir el patrón de "god controllers" (1500–3134 líneas) encontrado en la auditoría de JarvisBot. FastAPI se mantiene, aislado, solo para el motor de IA |
| 7 | Cláusula de contingencia explícita para el spike de semanas 1–2 (viable / parcialmente viable / no viable), mismo formato que Feature #9 | — | Protege a ambas partes: el spike depende de un tercero (TalkyTimes) fuera de control del equipo |
| 8 | Refuerzo explícito del vault: exclusión del campo contraseña de cualquier log de auditoría como **criterio de aceptación**, no detalle de implementación | — | JarvisBot tiene exactamente este problema (contraseña en texto plano en `activity_log` vía `spatie/laravel-activitylog`) — no repetirlo |
| 9 | **ETL batch diario de Tableau** (descargar CSV/Excel a hora fija → worker de procesamiento → almacenar en BD) en lugar de lectura en vivo de API | Tableau API como fuente en vivo | Tableau se refresca una sola vez al día según su propia configuración; dashboard "en vivo" no tiene sentido. Batch diario (a corte del día anterior) es más simple, independiente de Tableau (fallover transparente), predecible en rendimiento, y elimina bloqueadores de límite de filas/timeout de API. Patrón común en data warehousing |
| 19 | **Hash de contraseñas con scrypt** (`N=2^17`, `r=8`, `p=1`, parámetros guardados dentro de cada hash), no con bcrypt | bcrypt cost 12 (lo que nombra §4 del documento de requerimientos y §6.2 del plan de backend) | Aprobado por el cliente el 2026-08-04. bcrypt se había elegido por familiaridad previa, no por una propiedad técnica. scrypt es *memory-hard* y bcrypt no lo es (bcrypt usa ~4 KB fijos, barato de paralelizar en GPU/ASIC); ambos están en la lista recomendada de OWASP y NIST SP 800-63B, con Argon2id > scrypt > bcrypt como orden de preferencia habitual. Beneficio adicional: sin dependencia nativa que compilar en el contenedor de despliegue, y desaparece la truncación silenciosa de bcrypt a 72 bytes (§6.2 del plan la trataba como advertencia). Ver §5.3 para los parámetros y su costo medido |

### 5.1 Mecanismo concreto de la decisión #1 (2026-07-29)

Cómo se conectan el web-app, la extensión y el helper local, en orden:

```
Botón en web-app
   → chrome.runtime.sendMessage(EXTENSION_ID, {accion:"abrirPerfil", perfilId})
   → extensión recibe vía chrome.runtime.onMessageExternal
     (manifest: externally_connectable.matches = ["https://<dominio-webapp>/*"])
   → extensión reenvía al helper nativo por Native Messaging (stdin/stdout)
   → helper nativo (un solo binario, ideal en Go — sin runtime que instalar) lanza
     chrome.exe --profile-directory=X como proceso normal del SO
   → la extensión, ya preinstalada en ese perfil, inyecta la credencial vía content
     script (DOM normal, sin CDP/remote-debugging)
   → el operador da el clic real en "Log in"
```

**Por qué no un ejecutable que controle Chrome directamente (vía CDP/remote-debugging),
aunque sea en Go/Java en vez de Python+Selenium:** cualquier lenguaje que controle un
Chrome ya abierto sin pasar por una extensión necesita el protocolo CDP (el mismo que usa
Selenium y Playwright por debajo). Eso reintroduce la huella de automatización que la
decisión #1 ya descartó (puerto de debugging expuesto, efectos de `Runtime.enable`,
patrones de timing) — el riesgo no depende del lenguaje, depende de si el navegador está
bajo control remoto o si la inyección corre como content script de una extensión real.
El helper solo debe **lanzar el proceso**, nunca controlarlo después de abierto.

**Despliegue de la extensión en cada perfil nuevo:** no se instala a mano por perfil.
Se fuerza vía política de Chrome Enterprise (`ExtensionInstallForcelist`, registro de
Windows) para que todo perfil de esa instalación —existente o nuevo— la tenga instalada y
habilitada automáticamente.

**Mapeo perfil → cuenta:** el helper debe pasarle a cada perfil lanzado cuál cuenta le
corresponde (vía nombre de carpeta, argumento de lanzamiento, o archivo de config dentro
del propio `user-data-dir`), para que la extensión de ese perfil sepa qué credencial pedir
al vault.

**Escalamiento a varios perfiles simultáneos (ej. 8 por operador):** lanzamiento
escalonado (no todos de una vez — contención de disco/CPU al crear perfil y arrancar
Chrome), mismo patrón de espera entre lanzamientos que ya probó el spike en Python. El
consumo de RAM real a esa escala sigue sin confirmarse — ver §6.

### 5.2 Hallazgos verificados contra el DOM real de TalkyTimes (2026-07-30)

Cookie injection (login por HTTP directo) se descartó: el endpoint real
(`POST /platform/auth/login`) exige un campo `captcha` obligatorio — confirmado con una
petición de prueba real (credenciales falsas, sin captcha, devolvió
`{"data":{"status":false}}`, sin `Set-Cookie`). Resolver/bypassear ese captcha
automáticamente no es algo que se vaya a construir (ni con reingeniería del challenge ni
con un servicio de terceros tipo CapSolver) — reintroduce el mismo riesgo de continuidad
de la decisión #4, además de riesgo de baneo de las cuentas de los perfiles. Esto confirma
que la decisión #1 (extensión + clic manual, dejando que la página real resuelva su propio
captcha) es la única vía viable — nunca intenta reemplazar la llamada de login.

Validado en vivo en `https://talkytimes.com/auth/login` (solo inspección y manipulación de
DOM vía script — sin enviar login real, sin credenciales reales, sin CDP):

- **Botón "ver contraseña" real:** no es un `<button>` — es un `<svg id="EyeOff">` (cambia a
  `id="Eye"` al revelar), sin `aria-label`, hermano directo del `<input type="password">`,
  dentro de un componente Vue (`data-v-*`). Por eso no aparece en el árbol de accesibilidad,
  solo inspeccionando el DOM crudo. Content script que lo oculta (`extension/chrome-extension/
  content.js`) verificado contra la página real: 0 íconos restantes, formulario intacto.
- **Inyección de valores:** asignar `input.value = x` directo **no funciona** — Vue no
  reacciona. Hay que usar el setter nativo del prototipo + disparar eventos `input` y
  `change` para que el framework detecte el cambio. Verificado funcionando en la página real.
- **Dos `button[type="submit"]` en la página:** "Join talkytimes →" (registro, aparece
  primero en el DOM) y "Log in" (el real, después). Filtrar solo por `type="submit"` agarra
  el botón equivocado — hay que filtrar también por texto. Ya estaba anotado como advertencia
  en `extension/login_talkytimes.py`; queda reconfirmado contra la página real vigente.
- **Decidido: bloqueo de DevTools queda FUERA de esta versión (2026-07-30).** Se probó en
  una página local (`extension/spike_bloqueo_devtools.py`, política
  `DeveloperToolsAvailability`), pero no se integra al helper/instalador real. Razón: los
  operadores no son perfil técnico, y ocultar el ícono de "ver contraseña" (§5.2) ya cubre el
  escenario de exposición rutinaria que motivó el problema de negocio original (§1). **Riesgo
  residual aceptado:** un operador con conocimientos técnicos que abra DevTools manualmente
  (F12) igual podría leer el `value` del campo de contraseña en el DOM — no está mitigado en
  esta versión. Si en el futuro se detecta que esto ocurre en la práctica, retomar el spike ya
  probado en vez de partir de cero.

**Pipeline lanzador → extensión, validado de punta a punta (2026-07-30):** `extension/
lanzar_perfil_nativo.py` lanza Chrome vía `subprocess.Popen` con `--profile-directory=X`
contra un perfil nativo real (sin `--user-data-dir` propio, sin CDP, sin Selenium) —
el helper no vuelve a tocar el proceso después de abrirlo. La extensión, ya instalada en
ese perfil, hizo su trabajo sola al cargar `talkytimes.com`: ocultó el ícono y rellenó los
campos de prueba. Confirma que el mecanismo de la decisión #1 funciona tal como está
diseñado — lanzar + dejar que la extensión actúe por su cuenta, nada de control remoto.

**Hallazgo sobre `--load-extension` (2026-07-30):** ese flag, usado para simular "la
extensión ya viene preinstalada" sin cargarla a mano, es ignorado en silencio por Chrome
estable — Google lo restringió (sin mostrar error) para frenar malware que lo usaba para
instalar extensiones sin que el usuario se diera cuenta. Cargar una extensión sin empaquetar
vía `chrome://extensions` también quedó bloqueada por una restricción de **Modo Desarrollador
de Windows** (Configuración → Privacidad y seguridad → Para desarrolladores), con el mensaje
"La instalación no está habilitada". Esto refuerza que `ExtensionInstallForcelist` (política
de Chrome Enterprise) es la única vía viable para el despliegue real en PCs de oficina — no
un flag de lanzamiento ni carga manual, ninguno de los dos escala ni es confiable para eso.

**`ExtensionInstallForcelist` — pendiente de validar en PC de prueba real, no en equipo de
desarrollo (2026-07-30):** al intentar aplicar esta política en `HKEY_CURRENT_USER` para
probarla localmente, la creación de la clave `SOFTWARE\Policies\Google\Chrome` fue bloqueada
(`Acceso denegado`, confirmado también con `New-Item` directo en PowerShell, sin Python de
por medio) — muy probablemente Windows Defender u otro EDR protegiendo activamente esa ruta,
porque es exactamente el vector que usa malware/adware para forzar extensiones maliciosas sin
consentimiento. Se decidió **no forzarlo** en el equipo personal de desarrollo — correcto,
dado que el bloqueo está haciendo su trabajo. En producción esta política la escribe el
instalador del helper, elevado (UAC) y en `HKEY_LOCAL_MACHINE`, no un script en segundo plano
sin privilegios — ese es un patrón legítimo que Defender no debería bloquear de la misma
forma. **Falta validar esto en una PC de prueba real (no la de desarrollo) con un instalador
elevado de verdad, durante el spike técnico de semanas 1–2** — no se descartó el mecanismo,
solo se difirió al lugar correcto para probarlo.

**Validado en cambio (suficiente para confirmar el mecanismo extensión + content script):**
instalación manual de la extensión sin empaquetar (`chrome://extensions` → Cargar
descomprimida) en un perfil normal — funciona de punta a punta: oculta el ícono, inyecta los
valores de prueba, sin CDP, sin control remoto.

### 5.3 Parámetros de scrypt y su costo real (decisión #19, 2026-08-04)

`N=2^17, r=8, p=1` es el mínimo que OWASP acepta con `p=1`. Los parámetros viven **dentro de cada
hash** (`scrypt$<log2N>$<r>$<p>$<salt>$<digest>`), no en configuración: subirlos después no invalida
los hashes ya emitidos, y un hash con parámetros viejos se reescribe en el siguiente login, que es
el único momento en que existe la contraseña en claro. `PASSWORD_SCRYPT_LOG2N` (env) es el único
valor ajustable.

Se usa la variante **asíncrona** de `crypto.scrypt`, no `scryptSync`: con estos parámetros cada
hash cuesta cientos de milisegundos, y en la variante síncrona ese tiempo es event loop bloqueado
para toda la API — no solo para quien hace login. Medido en el equipo de desarrollo:

| `log2N` | Memoria por hash | Latencia |
|---|---|---|
| 15 | 32 MiB | ~82 ms |
| 16 | 64 MiB | ~170 ms |
| **17 (por defecto)** | **128 MiB** | **~342 ms** |

8 logins concurrentes a `log2N=17` tardan ~1.0 s en total (el threadpool de libuv procesa 4 a la
vez; `UV_THREADPOOL_SIZE` lo sube si hiciera falta).

**Tensión a vigilar en producción, no resuelta aquí:** el dimensionamiento cotizado al cliente es de
instancias de **1 GB de RAM** (§11 del documento de requerimientos). Cuatro hashes concurrentes a
128 MiB son 512 MiB transitorios sobre esa instancia, y los tres relevos del día (06:05, 14:05,
22:05) concentran logins de toda una cuadrilla en el mismo minuto. Si aparece presión de memoria,
la salida barata es `PASSWORD_SCRYPT_LOG2N=16` (64 MiB, ~170 ms, todavía por encima del escalón de
16 MiB que se usaba antes) — precisamente por eso el parámetro es configurable y viaja en el hash.
Medirlo con la cuadrilla real antes de decidir; no anticipar.

**Lo que no cambió en ninguna revisión:** alcance funcional completo (FR-01 a FR-39), honorarios
totales ($28.500.000 COP), estructura de 3 cuotas, ni el cronograma de 26 semanas.

## 6. Riesgos y preguntas abiertas activas

- Spike técnico de semanas 1–2, aún pendiente de ejecutar: (1) inyección de credenciales sin
  bloqueo de TalkyTimes, (2) aislamiento real de perfiles de Chrome sin fuga de cookies con varias
  sesiones simultáneas desde la misma IP de oficina, (3) cuánto puede leerse/controlarse del DOM de
  una conversación (base de Feature #9 y FR-39). Define la viabilidad de buena parte de la Entrega 1.
- Consumo de RAM real por perfil de Chrome abierto — determina el dimensionamiento de hardware de
  las PCs de oficina (estimado 16 GB para 5 perfiles, sin confirmar). Validar también con 8
  perfiles simultáneos por operador, no solo con el número usado en el spike inicial — ver §5.1.
- Preguntas abiertas de negocio listadas en §10 de `agency-os-requerimientos.md` (reglas exactas de
  icebreakers de TalkyTimes, si el score tiene mínimo bloqueante, turnos duplicados por perfil,
  alcance de cada coordinador, flujo de aprobación de icebreakers).
- **Relevo de perfil el mismo día — pregunta abierta #4 de §10, resuelta (2026-08-04):** el cliente
  confirmó que **sí**, un mismo perfil puede trabajarse en dos turnos del mismo día por operadores
  distintos. El modelo lo soporta sin cambios (constraint de exclusión por solapamiento, no por
  día). Lo que la respuesta sí obliga, detallado en [`backend/PLAN.md`](backend/PLAN.md) §4.1–§4.2:
  rangos semiabiertos `[)` para que el relevo a la hora exacta no colisione, cierre forzado de la
  sesión saliente con ventana de gracia (el precedente de JarvisBot en §4 de este archivo —
  "qué pasa cuando una operadora entra a un perfil que otra dejó abierto" — es el caso exacto y
  conviene mirarlo), y atribución de métricas por `occurred_at` y no por hora de ingesta.
- **Tableau tiene puntos por hora (2026-08-04) — resuelve la atribución del relevo:** el cliente
  informó que el reporte de puntos de Tableau existe con grano horario y que se pueden hacer cortes
  cada 8 h. Esto convierte la atribución en un relevo de "reparto estimado" a **asignación directa
  por hora**: cada hora de puntos cae dentro del `valid_range` de una sola asignación. Ver
  [`backend/PLAN.md`](backend/PLAN.md) §4.2. Tres consecuencias registradas ahí:
  (1) se toma el **grano horario, no los cortes de 8 h** — bloques fijos (00–08, 08–16, 16–00)
  vuelven a partir por la mitad un turno de 14:00–22:00 y los `shift_overrides` de horas extra por
  definición no caen en bloques fijos, así que el troceo lo hace el backend, que es quien conoce
  los rangos reales; (2) **no toca la decisión #9, la refuerza** — granularidad y frescura son
  cosas distintas: Tableau sigue refrescando una vez al día, así que la extracción sigue siendo
  batch diario, solo que cada corrida baja 24 filas por perfil en vez de 1; (3) queda estimación
  únicamente en la hora que atraviesa un relevo, y **desaparece del todo si los relevos se
  programan en hora en punto** — vale la pena pedirlo, es una restricción de calendario que elimina
  la única parte estimada del cálculo de nómina.
  **Pendientes que abre:** en qué zona horaria devuelve Tableau esas marcas (un desfase de una hora
  misatribuye exactamente en cada relevo y en ningún otro lado — el total del perfil cuadra y solo
  está mal el reparto entre dos personas), y si la vista horaria ya existe en el sitio del cliente
  o hay que crearla.
- **Horario real de turnos: 06:05, 14:05, 22:05 (2026-08-04).** Tres turnos de 8 h consecutivos sin
  hueco entre ellos. Consecuencias registradas en [`backend/PLAN.md`](backend/PLAN.md) §4.1–§4.3:
  (1) **ningún relevo cae en hora en punto**, así que los tres relevos del día atraviesan una hora
  — queda descartada la recomendación previa de "programar relevos en hora en punto", que se había
  anotado sin conocer el horario; (2) el reparto de esa hora pasa a ser **por minutos (5/55),
  determinista**, y ya no según lo que capturó la extensión: con 3 relevos diarios por perfil,
  depender de la captura de DOM habría creado una tarea manual permanente de resolución para
  repartir 5 minutos. El error es simétrico (cada operador cede 5 min al final y recibe 55 al
  principio) y su sesgo neto en el tiempo es cero; (3) al no haber hueco entre turnos, **la ventana
  de gracia para cerrar sesiones debe ser 0** — cualquier gracia al saliente es tiempo que el
  entrante pasa recibiendo 409 sin entender por qué; (4) el turno de 22:05 **cruza el corte de día
  y, una vez al mes, el de mes**: se guardan dos fechas por fila de puntos (fecha de inicio de
  turno para nómina, fecha calendario de la hora para conciliar con Tableau), y el periodo de
  nómina no se puede cerrar el día 1 sin dejar sin pagar el turno nocturno de la frontera.
  **Pendiente que vale la pena resolver antes de construir el troceo:** ver la tarea de
  verificación de filtros `vf_` más abajo.
- **TAREA PENDIENTE — probar si los filtros `vf_<campo>` de Tableau aceptan rangos de tiempo
  (anotada 2026-08-04, no ejecutada):** si aceptan, se puede pedir a la API directamente la ventana
  de un turno (06:05–14:05) y obtener el total exacto, con **cero estimación** — desaparece el
  reparto por minutos de [`backend/PLAN.md`](backend/PLAN.md) §4.2 y todo el troceo por horas. Si
  no aceptan, queda el reparto por minutos, que de todos modos es suficiente.
  - **No es pregunta para el cliente**, se resuelve probando: `GET /sites/{site-id}/views/{view-id}/data`
    con `vf_<campo-fecha>` y una sintaxis de rango, contra el sitio Tableau del cliente.
  - **Requiere lo que aún no tenemos:** credenciales/PAT del Tableau de la clienta 2 y saber qué
    vista tiene los puntos por hora (pendiente abierto arriba). Hasta tener eso, no se puede probar.
  - La colección `Tableau APIs.postman_collection.json` (§4) documenta `vf_<fieldname>=<value>`
    pero **no** dice si `<value>` admite rango — por eso hay que probarlo, no leerlo.
  - Guardar el resultado como evidencia (petición + respuesta cruda) igual que el resto de spikes,
    y registrar aquí el hallazgo con fecha.
- Rol "Director Operativo" (FR-02) mencionado pero no formalizado aún en la tabla de acceso por rol.
- **ETL de Tableau** — pendiente de confirmar con el cliente la lista exacta de vistas Tableau a
  descargar diariamente, su estructura de columnas, valores nulos esperados, y si tiene cambios
  históricos rastreables (para auditoría de cambios día a día). Implementación de worker, scheduler,
  y transformaciones de datos en la BD — scope aún por asignar a entrega específica (1 o 2).
- **Credenciales del spike de extensión aún en archivo plano, no en BD (2026-08-04):**
  [`extension/chrome-extension/`](../../AGENCY-OS/agency-os/extension/chrome-extension/) lee hoy
  `credenciales.json` (texto plano, en disco, vía `fetch('file:///...')` desde el background —
  `host_permissions: file:///*` en el manifest) — es el mismo patrón de credenciales en texto plano
  que la decisión #8 marcó como algo a no repetir de JarvisBot. Pasar esto a un backend real
  (NestJS + vault cifrado) implica: (1) la extensión ya no puede leer la BD directo, necesita un
  endpoint HTTP intermedio; (2) el helper nativo (no el content script) debería ser quien pida la
  credencial al backend justo antes de lanzar el perfil, no el content script en cada carga de
  página; (3) hace falta autenticar al helper/extensión ante ese endpoint (token por PC/operador);
  (4) habilita scoping por (operador, perfil), rotación sin tocar cada PC, y auditoría de acceso
  (cumpliendo el "sin loguear el campo contraseña" de la decisión #8) — nada de esto es posible con
  el archivo plano actual; (5) introduce una dependencia de red nueva: abrir un perfil pasa a
  depender de que el backend esté arriba. Pendiente de diseñar antes de que este spike se acerque a
  producción.
  **Diseñado (2026-08-04):** [`backend/PLAN.md`](backend/PLAN.md) §6.3 especifica el flujo completo
  (grant de un solo uso con TTL 60 s + redeem atómico, doble autenticación JWT de operador +
  token de dispositivo, seis validaciones previas, bitácora sin el valor). Resuelve el punto (2)
  **en contra** de lo que sugería este párrafo: quien pide la credencial es el **service worker
  (background) de la extensión**, no el helper nativo — el helper es un proceso por PC y tendría
  que hacerle llegar el secreto al perfil de Chrome correcto, creando un canal entre procesos que
  hoy no existe; el background ya corre dentro del perfil aislado (ver PLAN.md §1, decisión #10).
  Falta implementarlo: el spike sigue leyendo `credenciales.json` en texto plano.
- **Plan de backend escrito (2026-08-04):** [`backend/PLAN.md`](backend/PLAN.md) — modelo de datos
  completo (11 dominios), invariantes en la BD, superficie HTTP, seguridad, y 9 decisiones nuevas
  numeradas del #10 al #18 en continuación de la tabla de §5. Su §11 lista 10 preguntas abiertas
  que bloquean partes concretas de la construcción; la más cara es la lista de vistas de Tableau
  (ya listada arriba), que bloquea toda la transformación del ETL.
- **Patrón ETL diario de Tableau → almacenamiento propio (2026-07-29, resuelta):** el cliente
  confirmó que Tableau se refresca una sola vez al día según su propia configuración, por lo que
  dashboard "en vivo" no tiene sentido. **Decisión:** ETL batch diario via Tableau API —
  descarga a hora fija (ej. medianoche) de los CSV/Excel de las vistas que contienen nómina, puntos,
  métricas de perfiles e icebreakers, procesa en un worker (parsea, valida, enriquece), almacena
  en la BD del backend, y el dashboard lee el almacenamiento local a corte del día anterior.
  **Ventajas:** independencia de Tableau (si falla, dashboard sigue disponible con datos del día
  anterior), rendimiento predecible, historial auditable de cambios día a día, elimina bloqueadores
  de límite de filas/timeout de API. **Scope:** worker se integra en Entrega 1 o 2 (depende del
  plan). **Crítico:** confirmar con cliente la lista exacta de vistas Tableau a descargar y su
  estructura (columnas, valores nulos, cambios esperados entre días).
- **BD completa en NoSQL (Mongo) evaluada y descartada (2026-08-04, resuelta):** se analizó migrar
  toda la persistencia de Postgres a Mongo. **Decisión: no.** El dominio dominante del sistema
  (nómina por puntos, vault de credenciales, asignación de perfiles, ETL de Tableau) es relacional
  y financieramente sensible — necesita integridad referencial fuerte y transacciones
  multi-entidad, justo lo que un esquema normalizado con FKs da con menos código y menos sorpresas
  que documentos. Los únicos módulos con forma de dato realmente flexible (logs de auditoría de
  alto volumen, payload variable del scoring de icebreakers por IA) se resuelven con columnas
  `jsonb` dentro del mismo Postgres, sin pagar el costo operativo de mantener dos motores de BD en
  HA (dos topologías de alta disponibilidad, dos procedimientos de backup/restore, doble tooling de
  migraciones) en un proyecto de alcance y precio fijo. Además, Postgres+Redis en HA ya está en la
  estimación de infraestructura comunicada al cliente (§2, documento de requerimientos v2.2) —
  cambiar de motor tocaría un costo ya cotizado. Postgres+Redis se mantiene como la decisión vigente
  (decisión #6, §5).

## 7. Cómo mantener este archivo

Actualizar este documento cuando: cambie una decisión de arquitectura ya listada en §5, se resuelva
una pregunta abierta de §6, o aparezca un documento fuente nuevo que otro agente debería conocer.
No dupliques contenido de los documentos fuente aquí — referencia y resume, no copies secciones
completas.
