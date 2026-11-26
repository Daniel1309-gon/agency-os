# Manual de usuario de Agency OS

Este manual explica cómo usar Agency OS en el día a día: entrar al sistema, abrir perfiles, tomar breaks, pedir en cafetería, programar turnos y revisar la operación, según tu rol. Está escrito para personas sin perfil técnico. Cada función descrita existe en la aplicación; lo que todavía no está disponible se indica en la sección [7. Limitaciones actuales](#7-limitaciones-actuales--pendiente).

## Cómo leer este manual

- El texto entre comillas es **exactamente** el que ves en pantalla: nombres de botones, títulos y mensajes.
- Todas las horas son **hora de Bogotá** (America/Bogota, UTC−5, sin cambio de horario).
- "Operador" es el rol de las personas que atienden los perfiles. Se usa en sentido genérico para cualquier persona con ese rol.
- Algunos mensajes llegan del servidor en inglés. Están recogidos en la [sección 6](#6-preguntas-frecuentes-y-solución-de-problemas).

## Inicio rápido (si es tu primer día)

1. Entra con tu correo de Agency OS y la contraseña temporal que te entregó administración.
2. Define una contraseña nueva de al menos 12 caracteres y vuelve a entrar con ella.
3. Mira el menú lateral: solo verás las secciones que corresponden a tu rol.

## Índice

1. [Introducción](#1-introducción)
2. [Roles y permisos](#2-roles-y-permisos)
3. [Primeros pasos](#3-primeros-pasos)
4. [Módulos, paso a paso](#4-módulos-paso-a-paso)
5. [Flujos completos](#5-flujos-completos)
6. [Preguntas frecuentes y solución de problemas](#6-preguntas-frecuentes-y-solución-de-problemas)
7. [Limitaciones actuales / pendiente](#7-limitaciones-actuales--pendiente)
8. [Glosario](#8-glosario)
9. [Apéndice: administración técnica](#9-apéndice-administración-técnica)

---

## 1. Introducción

### 1.1 Qué es Agency OS

Agency OS es el sistema de gestión operativa de la agencia. Reúne en un mismo lugar:

- El acceso a los perfiles de TalkyTimes **sin que el operador vea nunca la contraseña**.
- La asignación de perfiles y turnos a los operadores, con sus relevos.
- El control de breaks, el seguimiento del equipo en vivo y la validación de icebreakers.
- La cafetería (pedidos, cocina, menú, ventas e inventario), la nómina y la auditoría.

### 1.2 Componentes

| Componente | Qué es | Quién lo usa |
|---|---|---|
| **Aplicación web de Agency OS** | Las pantallas del sistema en el navegador. Casi todo lo de este manual ocurre aquí. | Todos los roles |
| **Agente local** | Programa de la PC de oficina que abre Chrome con el perfil correcto, entra a TalkyTimes sin mostrar la contraseña y cierra el navegador cuando la sesión deja de estar autorizada. Lo instala administración. | Operadores, de forma indirecta al abrir un perfil |
| **Extensión de Chrome** "Agency OS - Acceso seguro a TalkyTimes" | Modo alternativo de apertura (extensión + helper). No es el modo de producción. | Solo si administración lo configura |
| **Rocket.Chat** | Mensajería interna del equipo. Agency OS programa avisos que se entregan allí. Se usa en su propia aplicación, no dentro de Agency OS. | Todo el equipo |
| **Motor de IA para icebreakers** | Evalúa los textos además de las normas locales. Es opcional según la configuración. | Operadores, de forma indirecta |

### 1.3 Horarios de referencia

- Todas las pantallas muestran y capturan las horas en **hora de Bogotá**.
- El horario de referencia de la operación es **06:05, 14:05 y 22:05**. Son turnos de 8 horas que no se solapan.

---

## 2. Roles y permisos

### 2.1 Roles

| Rol (nombre en pantalla) | Descripción que ves en el sistema |
|---|---|
| Operador | "Tus perfiles asignados y la operación de tu turno." |
| Coordinador | "Cobertura, equipo y seguimiento de la operación." |
| Cafetería | "Menú, ventas e inventario del punto de cafetería." |
| Director Operativo | "Métricas globales para dirigir la operación." |
| Administrador | "Métricas globales, seguridad y salud del sistema." |

Tu nombre y tu rol aparecen en el bloque **"Sesión actual"** del menú lateral.

### 2.2 Matriz de permisos

Leyenda: **✔** sí · **—** no · **Solo lectura** ves la pantalla pero no puedes cambiar nada · **Sin pantalla** la función existe en el sistema, pero no hay botón en la web (lo hace administración técnica).

| Función (sección del menú) | Operador | Coordinador | Cafetería | Director Operativo | Administrador |
|---|:-:|:-:|:-:|:-:|:-:|
| Mis perfiles: abrir perfil asignado | ✔ | — | — | — | — |
| Mi turno: iniciar turno y breaks | ✔ | — | — | — | — |
| Mis icebreakers: redactar, evaluar, publicar | ✔ | — | — | — | — |
| Cafetería: pedir productos | ✔ (solo en turno) | — | — | — | — |
| Cafetería: ver el estado de mis pedidos y cancelar un pedido recibido | ✔ | — | — | — | — |
| Mi nómina: mis puntos y mi pago estimado | ✔ | — | — | — | — |
| Equipo: semáforo de operadores | — | ✔ (su cuadrilla) | — | — | — |
| Métricas por perfil | — | ✔ (su cuadrilla) | — | ✔ | ✔ |
| Conciliación de puntos (Extensión vs Tableau) | — | — | — | ✔ | ✔ |
| Usuarios: ver | — | ✔ | — | ✔ | ✔ |
| Usuarios: crear, editar, deshabilitar | — | — | — | — | ✔ |
| Perfiles TalkyTimes: ver | — | ✔ | — | ✔ | ✔ |
| Perfiles: crear y editar datos | — | ✔ | — | ✔ | ✔ |
| Perfiles: retirar del catálogo | — | ✔ | — | ✔ | ✔ |
| Credencial de TalkyTimes: configurar o actualizar | — | ✔ | — | ✔ | ✔ |
| Asignaciones y relevos | — | ✔ | — | ✔ | ✔ |
| Cuadrillas: crear y gestionar miembros | — | ✔ (su cuadrilla) | — | ✔ | ✔ |
| Turnos: plantillas y turnos | — | ✔ | — | ✔ | ✔ |
| Overrides (horas extra, excepciones) | — | ✔ | — | ✔ | ✔ |
| Icebreakers: revisar infracciones | — | ✔ | — | ✔ | ✔ |
| Icebreakers: crear, editar o pausar reglas | — | — | — | — | ✔ |
| Mensajes programados (Rocket.Chat) | — | ✔ | — | ✔ | ✔ |
| Nómina: ver periodos y líneas | — | — | — | ✔ | ✔ |
| Nómina: exportar Excel (.xlsx) | — | — | — | — | ✔ |
| Pedidos de cafetería (pantalla de cocina) | — | — | ✔ | — | — |
| Menú de hoy | — | — | ✔ | — | — |
| Ventas de cafetería | — | — | ✔ | ✔ | ✔ |
| Inventario de cafetería | — | — | ✔ | ✔ | ✔ |
| Auditoría (solo lectura) | — | ✔ | — | ✔ | ✔ |
| Seguridad: estado, alertas y estaciones | — | — | — | — | ✔ |
| Acceso por IP | — | — | — | — | ✔ |
| Entregas: cola de Rocket.Chat | — | — | — | — | ✔ |

Notas de la matriz:

- **Equipo** no aparece en el menú del Director Operativo ni del Administrador. El seguimiento en vivo lo hace el Coordinador.
- **Nómina** y **Mensajes** no aparecen en el menú de cafetería ni de coordinación, aunque el coordinador tiene permiso de consulta de nómina en el sistema. Si necesitas esa consulta, pídela a administración.
- Un rol que no tiene permiso **no ve la sección en el menú**. Si escribes a mano la dirección de una sección que no te corresponde, la aplicación te lleva a tu primera sección disponible.

### 2.3 Alcance de cada rol

- **Operador:** solo ve sus perfiles asignados, sus turnos, sus icebreakers y su cuenta de cafetería.
- **Coordinador:** solo ve y gestiona a los operadores y perfiles de **sus cuadrillas**. Si intenta actuar fuera de ese alcance, el servidor lo rechaza. Cuando crea una cuadrilla, queda asignado como su coordinador automáticamente.
- **Director Operativo:** visión global de la operación. No administra usuarios ni seguridad.
- **Administrador:** acceso completo, incluidos usuarios, seguridad, auditoría y entregas.

---

## 3. Primeros pasos

### 3.1 Iniciar sesión

1. Abre la dirección de Agency OS que te indique administración.
2. En el campo **"Correo o usuario"**, escribe tu correo de Agency OS.
3. En el campo **"Contraseña"**, escribe tu contraseña. Usa el ícono de ojo para mostrarla u ocultarla.
4. Pulsa **"Entrar al workspace"**.
5. Verás "Validando acceso…". Si todo está bien, entras a tu primera sección disponible.

**Qué tener en cuenta:**

- Si ya tenías una sesión abierta, verás brevemente "Verificando tu sesión segura…" antes de entrar.
- El enlace **"¿Olvidaste tu contraseña?"** solo muestra el aviso "Contacta a coordinación para recuperar el acceso a tu cuenta." Hoy no hay restablecimiento desde la pantalla (ver [sección 7](#7-limitaciones-actuales--pendiente)).
- La casilla **"Refresh seguro en cookie HttpOnly"** es informativa. No activa ni desactiva nada: tu sesión se renueva sola.
- **Operadores:** por configuración predeterminada, solo puedes entrar durante tu ventana de turno programada o con una excepción aprobada vigente. Fuera de ese horario verás el mensaje indicado en la [sección 6.1](#61-entrar-al-sistema).

### 3.2 Cambio de contraseña obligatorio (primer acceso)

Cuando administración crea tu usuario o restablece tu contraseña, el sistema te pide cambiarla antes de entrar.

1. Entra con tu correo y la **contraseña temporal**.
2. Verás la pantalla **"Primer acceso"** con el título **"Actualiza tu contraseña."**
3. Completa los tres campos:
   - **"Contraseña temporal"**: la que te entregó administración.
   - **"Nueva contraseña"**: mínimo **12 caracteres**.
   - **"Repite la nueva contraseña"**: debe coincidir exactamente.
4. Pulsa **"Guardar contraseña"**.
5. Al guardar, la sesión se cierra. Entra de nuevo con tu correo y la **contraseña nueva**.

Si las dos contraseñas nuevas no coinciden, verás "Las contraseñas nuevas no coinciden.". Si la contraseña temporal es incorrecta, verás "El correo o la contraseña no son correctos.".

### 3.3 Sesión, renovación y cierre

- Tu sesión se renueva sola mientras la uses.
- Si el servicio no responde al abrir la aplicación, verás **"Estamos verificando tu acceso."** con el botón **"Reintentar conexión"**. Reintentar **no** te pide la contraseña otra vez.
- **Para salir:** pulsa tu nombre (arriba a la derecha; en pantallas pequeñas, tus iniciales) y luego **"Cerrar sesión"**.
- **Operadores:** cuando termina la ventana de tu turno, el sistema deja de renovar la sesión. En tu siguiente turno tendrás que volver a entrar.

### 3.4 Navegación

- En pantallas anchas, el **menú lateral** muestra las secciones agrupadas en **Operación**, **Control** y **Punto** (cafetería).
- En pantallas angostas, la barra superior muestra el nombre de la sección actual y un botón de menú (tres líneas) que abre la lista de secciones.
- Cada sección tiene un encabezado con una etiqueta, un título y una descripción breve.

Rutas de cada sección (útiles si administración te pide abrir una pantalla concreta):

| Sección | Ruta | Roles |
|---|---|---|
| Mis perfiles / Perfiles | `/app/perfiles` | Operador / Coordinador, Director, Administrador |
| Mi turno | `/app/turno` | Operador |
| Icebreakers (operador) | `/app/icebreakers` | Operador |
| Mi nómina | `/app/mi-nomina` | Operador |
| Cafetería (pedir) | `/app/cafeteria` | Operador |
| Equipo | `/app/equipo` | Coordinador |
| Métricas | `/app/metricas` | Coordinador, Director, Administrador |
| Usuarios | `/app/usuarios` | Coordinador, Director, Administrador |
| Asignaciones | `/app/asignaciones` | Coordinador, Director, Administrador |
| Cuadrillas | `/app/cuadrillas` | Coordinador, Director, Administrador |
| Turnos | `/app/turnos` | Coordinador, Director, Administrador |
| Nómina | `/app/nomina` | Director, Administrador |
| Icebreakers (revisión) | `/app/icebreakers-revision` | Coordinador, Director, Administrador |
| Mensajes | `/app/mensajes` | Coordinador, Director, Administrador |
| Auditoría | `/app/auditoria` | Coordinador, Director, Administrador |
| Pedidos (cocina) | `/app/pedidos` | Cafetería |
| Menú | `/app/menu` | Cafetería |
| Ventas | `/app/ventas` | Cafetería, Director, Administrador |
| Inventario | `/app/inventario` | Cafetería, Director, Administrador |
| Seguridad | `/app/seguridad` | Administrador |
| Acceso por IP | `/app/acceso-ip` | Administrador |
| Entregas | `/app/entregas` | Administrador |

### 3.5 Equipo autorizado

- **Abrir un perfil solo funciona desde una PC aprobada.** Cada PC de oficina debe estar registrada por administración (con su certificado de equipo) y tener instalada la extensión y el helper. Si intentas abrir un perfil desde una PC no aprobada, el sistema lo rechaza.
- Si administración **revoca** tu PC, dejará de abrir perfiles. Avisa a coordinación para que la revisen.
- El certificado identifica la **PC**, no a la persona. Quien inicia sesión sigue siendo cada usuario con su propia contraseña.

---

## 4. Módulos, paso a paso

Cada módulo sigue el mismo orden: **quién lo usa**, **dónde está**, **cómo hacerlo**, **qué verás** y **mensajes frecuentes**.

### 4.1 Mis perfiles: abrir y continuar un perfil

**Quién lo usa:** Operador.
**Dónde está:** menú → **Mis perfiles** (`/app/perfiles`).

**Qué es:** la lista de los perfiles de TalkyTimes asignados a tu turno actual. Verás el nombre del perfil, su usuario de TalkyTimes, su estado y la hora de inicio de la sesión. **Nunca verás la contraseña.**

**Estados que puede mostrar cada fila:**

| Estado en pantalla | Qué significa | Qué hacer |
|---|---|---|
| Disponible | No hay sesión abierta. | Pulsa **"Abrir perfil ↗"**. |
| Sesión activa | El perfil ya está abierto en tu turno. | Pulsa **"Continuar ↗"**. |
| Abriendo perfil | El sistema está preparando la apertura. | Espera. No pulses de nuevo. |
| Reintento disponible | La apertura anterior falló. | Pulsa **"Abrir perfil ↗"** otra vez. |
| Sesión vencida; reabrir | La sesión dejó de recibir señal de la PC. | Pulsa **"Abrir perfil ↗"**. |

**Cómo abrir un perfil:**

1. Entra a **"Mis perfiles"**. Si no ves un perfil que debería aparecer, pulsa **"Actualizar ↻"**.
2. Revisa la fila del perfil y pulsa **"Abrir perfil ↗"**. Mientras se prepara, el botón dice **"Preparando…"**.
3. Espera el aviso "Perfil [nombre] abierto por el agente local.".
4. Se abre Chrome con el perfil correcto y el agente local entra a TalkyTimes por ti: completa el usuario y la contraseña y pulsa el ingreso. Nunca ves la contraseña.
5. Trabaja en el perfil durante tu turno.
6. Si vuelves a la aplicación con la sesión abierta, la fila mostrará **"Sesión activa"** y el botón **"Continuar ↗"** te lleva de nuevo a esa ventana.

**Cerrar un perfil:**

- Pulsa **"Cerrar"** en la fila con sesión activa al terminar.
- Si no lo cierras, el agente cierra Chrome solo cuando termina tu asignación o cuando la sesión deja de estar autorizada.

**Mensajes frecuentes:**

| Mensaje | Qué significa |
|---|---|
| "No tienes perfiles asociados en el turno actual." | No tienes asignación vigente en este momento. Consulta con coordinación. |
| "La extensión segura no está disponible en este navegador." | Abriste la aplicación en un navegador sin la extensión. Usa el Chrome de tu PC de oficina. |
| "La extensión segura no respondió." / "La extensión no pudo preparar el perfil." | La extensión no pudo completar la apertura. Pulsa **"Abrir perfil ↗"** otra vez; si se repite, avisa a administración. |
| "El agente local no pudo abrir el perfil." / "No pudimos conectar con el agente local." | El agente de la PC no responde. Avisa a administración técnica. |
| "La sesión segura expiró. Vuelve a iniciar sesión." | Tu sesión de Agency OS venció. Entra de nuevo. |
| "La sesión anterior de [perfil] terminó. Vuelve a abrir el perfil." | La sesión previa ya no estaba activa. Vuelve a abrir el perfil. |
| "Profile already has a live session" (en inglés) | Otra persona tiene el perfil abierto. Coordina con ella antes de abrirlo. |
| "No active assignment for this profile" (en inglés) | El perfil ya no está asignado a tu turno. Pide actualizar la asignación a coordinación. |

### 4.2 Mi turno: inicio de turno y breaks

**Quién lo usa:** Operador.
**Dónde está:** menú → **Mi turno** (`/app/turno`).

**Qué ves:**

- **"Ventana programada"**: la hora de inicio y fin de tu turno, y la fecha de la jornada.
- El estado del turno: **Programado**, **En curso**, **Completado** o **Cancelado**.
- Tu hora real de inicio y cuántos minutos llegaste tarde o temprano ("X min después de lo programado", "a la hora programada").
- La lista de tus breaks del turno, con su estado.

**Cómo iniciar tu turno:**

1. Entra dentro de la ventana programada. **El turno solo se puede iniciar durante su horario.**
2. En **"Mi turno"**, pulsa **"Iniciar turno"**.
3. Verás el estado **"En curso"** y tu hora real de inicio.

Si no tienes turno en este horario, verás: "No tienes un turno en este horario."

**Cómo tomar un break:**

Reglas del sistema:

- El turno tiene **dos ventanas de 4 horas**, contadas desde la **hora programada** de inicio: la primera en las primeras 4 horas y la segunda en las 4 siguientes.
- **Puedes tomar un break por ventana.** Lo que no tomes en su ventana se pierde.
- Un break dura **como máximo 20 minutos**. Si lo dejas abierto, se cierra solo.
- Llegar tarde **no** mueve las ventanas: se cuentan desde la hora programada.

Pasos:

1. Dentro de una ventana, verás "Ventana 1 de break · hasta las HH:MM" (o "Ventana 2 de break…").
2. Pulsa **"Iniciar break"**. Aparece "Break en curso · termina en mm:ss" con la cuenta regresiva.
3. Para terminar antes, pulsa **"Finalizar break ↗"** en la fila del break.
4. Cuando termina, la fila muestra el estado **"Completado"** y la duración en minutos.

Mensajes sobre breaks:

| Mensaje | Qué significa |
|---|---|
| "Ya tomaste el break de esta ventana." | Ya usaste el break de la ventana actual. |
| "Las ventanas de break de este turno ya pasaron." | Ya no hay ventanas disponibles en este turno. |
| "Todavía no tomaste ningún break en este turno." | No has tomado breaks todavía. |
| "No shift in progress" (en inglés) | Quieres tomar un break sin haber iniciado tu turno. Pulsa primero **"Iniciar turno"**. |
| "Breaks are only available during the first eight hours of the shift" (en inglés) | Intentaste un break después de las primeras 8 horas del turno. |
| "Operator already has an active break" (en inglés) | Ya tienes un break en curso. Finalízalo antes de iniciar otro. |

**Cómo termina tu turno:** el turno se cierra **solo** a su hora programada. No necesitas cerrarlo. Si un break sigue abierto en ese momento, se cierra con el fin del turno o a los 20 minutos, lo que ocurra primero.

### 4.3 Mis icebreakers (operador)

**Quién lo usa:** Operador.
**Dónde está:** menú → **Icebreakers** (`/app/icebreakers`).

**Qué es:** el lugar donde redactas tus icebreakers, los evalúas contra las normas de TalkyTimes y los publicas. Título de la sección: **"Mis icebreakers"**.

**Estados y acciones:**

| Estado | Qué significa | Acciones disponibles |
|---|---|---|
| Borrador | Texto guardado, sin evaluar. | Editar, Evaluar |
| Bloqueado | La evaluación encontró un incumplimiento. | Editar, Evaluar |
| Aprobado | La evaluación lo aprobó. | Evaluar, Publicar |
| Publicado | Registrado como publicado. | Ninguna (es definitivo) |

**Cómo crear un icebreaker:**

1. En **"Nuevo icebreaker"**, elige en **"Perfil"** el perfil para el que lo escribes. La lista solo muestra los perfiles asignados a tu turno actual. Si no aplica, deja **"Sin perfil"**.
2. Escribe el texto en el campo **"Texto (n/2000)"**. El contador muestra cuántos caracteres llevas.
3. Pulsa **"Guardar borrador"**. El texto aparece en la lista con el estado **Borrador**.

**Cómo evaluar un icebreaker:**

4. En la tarjeta del icebreaker, pulsa **"Evaluar"**. Mientras se evalúa, el botón dice "Evaluando…".
5. Lee el resultado que aparece bajo la tarjeta:
   - "Aprobado: ya puedes publicarlo." o "Aprobado con advertencias: ya puedes publicarlo." El estado pasa a **Aprobado**.
   - "Bloqueado: incumple las normas de TalkyTimes y no se puede publicar." El estado pasa a **Bloqueado**.
   - La lista de detalle muestra cada norma como "Bloqueante: [nombre]" o "Advertencia: [nombre]". Si el motor de IA da un puntaje, verás también "Puntaje: n/100".

**Cómo corregir un icebreaker bloqueado:**

6. Pulsa **"Editar"**, cambia el texto y pulsa **"Guardar"**. Para cancelar sin guardar, pulsa **"Cancelar"**.
7. Vuelve a pulsar **"Evaluar"**. Un texto editado necesita una evaluación nueva antes de publicarse.

**Cómo publicar:**

8. Cuando el estado sea **Aprobado**, pulsa **"Publicar"**. El estado cambia a **Publicado**.
9. Publicar solo es posible si el perfil del icebreaker sigue asignado a tu turno.

> **Nota:** "Publicar" registra el icebreaker como publicado en Agency OS y queda auditado. Hoy Agency OS **no envía el texto a TalkyTimes**. El flujo de envío está pendiente de definir (ver [sección 7](#7-limitaciones-actuales--pendiente)).

**Mensajes frecuentes:**

| Mensaje | Qué significa |
|---|---|
| "Escribe el icebreaker antes de guardarlo." | El texto está vacío. |
| "El icebreaker no puede superar 2000 caracteres." | Acorta el texto. |
| "No pudimos guardar los cambios. Recarga e inténtalo de nuevo." | El texto cambió mientras lo editabas. Recarga la página. |
| "No pudimos evaluar el icebreaker." | La evaluación falló y el texto no se publica. Intenta de nuevo más tarde. |
| "A published icebreaker cannot be evaluated again" (en inglés) | El icebreaker ya está publicado y no se reevalúa. |
| "AI evaluation failed; the icebreaker was not published" (en inglés) | El motor de IA no respondió. El texto no se publica; intenta más tarde. |
| "Icebreaker requires an approved evaluation" (en inglés) | Intentaste publicar sin estar en Aprobado. Evalúalo primero. |
| "Icebreaker is not editable or has changed" (en inglés) | Ya no se puede editar (está publicado o cambió). Recarga la lista. |

### 4.4 Pedir a cafetería (operador)

**Quién lo usa:** Operador.
**Dónde está:** menú → **Cafetería** (`/app/cafeteria`). Título: **"Pide a cafetería"**.

**Requisito:** debes estar en tu turno. Fuera de turno, el pedido se rechaza.

**Cómo pedir:**

1. Revisa el monto de **"Consumido este mes"** en la parte superior.
2. En cada producto, pulsa **"+"** para agregar (**"Agregar [producto]"**) o **"−"** para quitar (**"Quitar [producto]"**). Máximo 20 unidades por producto.
3. Revisa el **"Total seleccionado"** en la parte inferior.
4. Pulsa **"Enviar pedido ↗"**. Verás el aviso: "Pedido recibido. Sigue su estado en "Mis pedidos"." El pedido aparece de inmediato en la lista **"Mis pedidos"**.

**Qué tener en cuenta:**

- Solo aparecen los productos disponibles en ese momento. Los productos pausados no se muestran.
- El botón se bloquea mientras el pedido se envía. No pulses dos veces.
- Cuando cafetería **entrega** el pedido, el importe se descuenta de tu cuenta del mes. Ese descuento también afecta la nómina (ver [4.14](#414-nómina)).

**Cómo seguir tus pedidos:**

En la parte inferior, la lista **"Mis pedidos"** muestra tus 10 pedidos más recientes con su número, la hora, los productos, el total y el estado. El estado cambia solo, en vivo, cuando cafetería mueve el pedido; no necesitas recargar.

| Estado | Qué significa |
|---|---|
| Recibido | Cafetería todavía no lo ha aceptado. Aún puedes cancelarlo. |
| Aceptado | Cafetería lo aceptó. Ya no se puede cancelar desde aquí. |
| En preparación | Lo están preparando. |
| Listo para recoger | Está listo. Verás "Retíralo antes de las HH:MM": pásalo a buscar antes de esa hora. |
| Entregado | Lo recibiste. Su valor se descuenta de tu cuenta del mes. |
| Cancelado | Se canceló y no se cobra. |
| Expirado | No se retiró a tiempo. No se cobra. |

**Cómo cancelar un pedido:**

1. En **"Mis pedidos"**, busca el pedido en estado **Recibido**.
2. Pulsa **"Cancelar"**. Verás: "Pedido #[número] cancelado."
3. Si cafetería lo aceptó justo antes, verás: "Cafetería ya aceptó este pedido y no se puede cancelar desde aquí. Habla con cafetería." La lista se actualiza con el estado real.

**Mensajes frecuentes:**

| Mensaje | Qué significa |
|---|---|
| "No pudimos cargar tu menú de cafetería." | Recarga la página. Si se repite, avisa a administración. |
| "No pudimos registrar el pedido." | El pedido no se envió. Revisa tu selección e intenta de nuevo. |
| "Operator is outside an approved shift" (en inglés) | No estás en tu ventana de turno. Los pedidos solo se aceptan durante el turno. |

### 4.4b Mi nómina (operador)

**Quién lo usa:** Operador.
**Dónde está:** menú → **Mi nómina** (`/app/mi-nomina`). Título: **"Mi nómina"**.

**Qué ves:**

- **"Mis puntos"**: tus puntos del periodo, ya calculados con tu comisión.
- **"Mi pago estimado"**: el valor en pesos de esos puntos, antes de descontar cafetería y ajustes.
- El nombre, las fechas y el estado del periodo: **En curso**, **En revisión**, **Liquidado** o **Pagado**.

Por diseño, no ves tus puntos brutos, la tasa de conversión ni tu porcentaje de comisión.

**Cómo consultar:**

1. Al entrar ves el periodo en curso.
2. Para ver otro periodo, elígelo en **"Periodo"**.
3. Pulsa **"Actualizar ↻"** para traer las cifras más recientes.

**Qué tener en cuenta:**

- Las cifras se actualizan con los datos de Tableau del día anterior. El valor definitivo es el del periodo liquidado.
- Si ves "Tu comisión todavía no está configurada para este periodo. Consulta con coordinación.", administración aún no te asignó comisión y no se muestran cifras.
- Si ves "No hay un periodo de nómina en curso. Consulta con coordinación.", todavía no se abrió el periodo de este mes.

### 4.5 Equipo: semáforo de operadores (coordinador)

**Quién lo usa:** Coordinador (solo los operadores de su cuadrilla).
**Dónde está:** menú → **Equipo** (`/app/equipo`). Título: **"Tu equipo, en movimiento."**

**Qué ves:**

- **"Cobertura actual"**: porcentaje de operadores visibles que tienen sesión activa o están en break.
- **"Equipo conectado"**: cuántos operadores tienen alguna sesión abierta, frente al total visible.
- **"Alertas pendientes"**: cuántas alertas hay abiertas.
- La tabla **"Semáforo de operadores"** con cada persona, su estado, la señal y la hora de actualización.

| Estado | Significado |
|---|---|
| Activo | Tiene una sesión operativa abierta. |
| En break | Tiene un break registrado en curso. |
| Alerta | Requiere seguimiento del coordinador. |
| Fuera de turno | No tiene una sesión operativa abierta. |

**Cómo usarlo:**

1. Revisa la cobertura y el número de alertas en las tarjetas superiores.
2. Si hay una alerta, aparece el aviso **"Seguimiento prioritario · [nombre]"**. Revísala antes de asignar el siguiente relevo.
3. El encabezado indica **"actualización en vivo"** cuando la pantalla recibe cambios automáticos, o **"último snapshot"** cuando muestra la última foto. Pulsa **"Actualizar ↻"** si lo necesitas.

### 4.6 Métricas por perfil

**Quién lo usa:** Coordinador (su cuadrilla), Director Operativo y Administrador (toda la operación).
**Dónde está:** menú → **Métricas** (`/app/metricas`).

**Qué ves:**

- Cuatro tarjetas: **"Operadores conectados"**, **"Sesiones activas"**, **"Cobertura de turnos"** y **"Pedidos pendientes"**.
- **"Rendimiento por perfil"**: puntos, mensajes, respuestas y tasa de respuesta por perfil.
- **"Serie diaria"** de un perfil, al pulsar **"Ver serie"**: fecha, fuente, puntos, mensajes y respuestas, e icebreakers enviados y respondidos.
- Solo Director y Administrador ven **"Conciliación de puntos"**: fecha, perfil, puntos de la extensión, puntos de Tableau, diferencia y estado ("En tolerancia" o "Divergente").

**Cómo consultar:**

1. Elige el rango en **"Desde"** y **"Hasta"**. Por defecto muestra los últimos 7 días.
2. Revisa la tabla de rendimiento. Pulsa **"Ver serie"** en un perfil para ver su detalle diario.
3. Si hay una diferencia en la conciliación, anótala y consúltala con administración.

> **Nota:** las cifras dependen de la ingesta de métricas y de los datos de Tableau, que todavía están en curso (ver [sección 7](#7-limitaciones-actuales--pendiente)).

### 4.7 Usuarios y roles

**Quién lo usa:** ver, Coordinador, Director Operativo y Administrador. Crear, editar y deshabilitar, solo Administrador.
**Dónde está:** menú → **Usuarios** (`/app/usuarios`). Título: **"Usuarios y roles"**.

**Qué ves:** la tabla con **Persona** (nombre y correo), **Rol**, **Estado** (Activo, Suspendido o Deshabilitado) y **Último acceso** ("Sin acceso" si nunca entró). El campo **"Buscar usuario"** filtra por nombre o correo.

**Cómo crear un usuario (Administrador):**

1. Pulsa **"Nuevo usuario +"**.
2. Completa:
   - **"Nombre completo"**
   - **"Correo"**
   - **"Contraseña inicial"**: entre 12 y 72 caracteres.
   - **"Rol"**: elige uno de los cinco roles.
   - **"Teléfono"** (opcional).
3. Pulsa **"Crear usuario ↗"**. Verás: "Usuario creado. Deberá cambiar la contraseña en su primer acceso."

**Cómo editar un usuario (Administrador):**

1. En la fila, pulsa **"Editar"**.
2. Cambia **nombre**, **rol** o **teléfono**. El **correo no se puede cambiar**.
3. Pulsa **"Guardar cambios ↗"**. Verás: "Usuario actualizado correctamente."

**Cómo deshabilitar un usuario (Administrador):**

1. En una fila con estado **Activo**, pulsa **"Deshabilitar"**.
2. Verás: "[nombre] quedó deshabilitado." La persona ya no podrá entrar.

> **Nota:** la pantalla no tiene botón para restablecer contraseñas (ver [sección 7](#7-limitaciones-actuales--pendiente)).

### 4.8 Perfiles TalkyTimes (catálogo y credenciales)

**Quién lo usa:** Coordinador, Director Operativo y Administrador.
**Dónde está:** menú → **Perfiles** (`/app/perfiles`). Título: **"Perfiles TalkyTimes"**. Los operadores ven la misma ruta como **"Mis perfiles"** (ver [4.1](#41-mis-perfiles-abrir-y-continuar-un-perfil)).

**Qué es:** el catálogo de cuentas de TalkyTimes de la agencia. Aquí se administran los datos del perfil y su carpeta de Chrome. **Las contraseñas nunca se muestran ni se guardan en el navegador.**

**Columnas:** **Perfil**, **Estado** (Activo, Inactivo, Suspendido o Retirado), **Chrome** (la carpeta del perfil de Chrome, o "Pendiente") y **Credencial** ("Configurada · v[n]" o "Pendiente").

**Cómo crear un perfil:**

1. Pulsa **"Nuevo perfil +"**.
2. Completa:
   - **"Nombre visible"**
   - **"Correo de TalkyTimes"**
   - **"Referencia externa"** (opcional)
   - **"País ISO"**: dos letras; por defecto **CO**.
   - **"Perfil nativo de Chrome"**: **"Default"**, **"Profile 1"** a **"Profile 8"**, o **"Sin vincular"**.
   - **"Notas operativas"** (opcional).
3. Pulsa **"Crear perfil ↗"**. Verás: "Perfil creado. Recuerda asociar su credencial desde el vault seguro."

> Un perfil sin carpeta de Chrome vinculada no se puede abrir. Tampoco se puede cambiar la carpeta mientras el perfil tiene una sesión abierta.

**Cómo configurar la credencial:**

1. En la fila del perfil, pulsa **"Configurar clave"** (o **"Actualizar clave"** si ya existe).
2. Completa **"Usuario o correo"** y **"Nueva contraseña"**. La contraseña es obligatoria, no se precarga y se borra al cerrar el formulario.
3. Pulsa **"Guardar credenciales ↗"**. Verás: "Credenciales actualizadas. La contraseña solo se entregará al agente local durante el inicio."

> El aviso menciona al agente local. La contraseña se entrega **solo en el momento de abrir el perfil**, nunca antes.

**Cómo editar y retirar un perfil:**

- **"Editar"** abre los datos del perfil. Una vez configurada la credencial, el **correo de TalkyTimes** es de solo lectura: cámbialo desde **"Actualizar clave"**, para mantener sincronizada la credencial.
- **"Retirar"** (solo perfiles activos) saca el perfil del catálogo: verás "[perfil] quedó retirado del catálogo." Un perfil retirado ya no aparece para nuevas asignaciones.

### 4.9 Asignaciones y relevos

**Quién lo usa:** Coordinador, Director Operativo y Administrador.
**Dónde está:** menú → **Asignaciones** (`/app/asignaciones`). Título: **"Asignaciones y relevos"**.

**Qué es:** la tabla que dice qué perfil cubre qué operador y en qué franja horaria. Cada fila resume una franja recurrente.

**Relación con los turnos:** los **turnos** definen la jornada del operador; la **asignación** define qué perfil cubre durante esa ventana. Si no hay un turno vinculado, la fila aparece como **"Ventana libre"**.

**Cómo crear una asignación:**

1. Pulsa **"Nueva asignación +"**.
2. Elige el **"Perfil"** (solo perfiles activos) y el **"Operador"** (solo operadores activos).
3. Indica el **"Período desde"** y el **"Período hasta"**.
4. Marca los **"Días de la semana"** (al menos uno).
5. Indica la **"Hora de inicio diaria"** y la **"Hora de fin diaria"**. Si la hora de fin es menor que la de inicio, el tramo cruza la medianoche.
6. Pulsa **"Guardar asignación ↗"**. El sistema crea un tramo por cada día seleccionado dentro del período.

**Cómo hacer un relevo:**

1. En la fila de la asignación activa, pulsa **"Preparar relevo"**.
2. El formulario llega prellenado: el mismo perfil, un operador distinto sugerido, inicio al fin del tramo actual y 8 horas de duración.
3. **Verifica el operador y las fechas** y pulsa **"Guardar asignación ↗"**.
4. Si el nuevo tramo empieza exactamente cuando termina el anterior, el sistema registra el relevo y cierra la sesión de la persona saliente.

**Cómo finalizar una asignación:**

1. En la fila activa, pulsa **"Finalizar"**.
2. Verás: "Asignación finalizada y sesiones asociadas cerradas."

**Estados:** **Activa**, **Relevo cerrado** (terminó por un relevo) o **Finalizada**. Si una asignación tiene varios tramos, pulsa **"Ver N tramos"** para verlos uno por uno.

**Filtros:** el historial se puede filtrar por **Operador** y por **Perfil**.

### 4.10 Cuadrillas

**Quién lo usa:** Coordinador (solo su cuadrilla), Director Operativo y Administrador.
**Dónde está:** menú → **Cuadrillas** (`/app/cuadrillas`). Título: **"Cuadrillas"**.

**Cómo crear una cuadrilla:**

1. En **"Crear cuadrilla"**, escribe el **"Nombre"**.
2. Si eres Director o Administrador, elige el **"Coordinador"** o deja **"Sin asignar"**. Si eres coordinador, la cuadrilla queda a tu nombre.
3. Pulsa **"Crear cuadrilla"**. Verás: "Cuadrilla «[nombre]» creada."

**Cómo agregar un operador:**

1. En **"Agregar miembro"**, elige la **"Cuadrilla"**, el **"Operador"**, **"Vigente desde"** y **"Vigente hasta (incluido)"** (por defecto, 90 días).
2. Pulsa **"Agregar a la cuadrilla"**. Verás: "[operador] quedó en [cuadrilla]."

> Un operador no puede estar en dos cuadrillas a la vez en la misma vigencia.

**Cómo quitar un operador:**

1. En la lista **"Miembros de [cuadrilla]"**, pulsa **"Quitar"**.
2. Verás: "[operador] salió de la cuadrilla. Su vigencia se cerró hoy." A partir de esa fecha, las plantillas de esa cuadrilla ya no generan turnos para él.

### 4.11 Turnos, plantillas y overrides

**Quién lo usa:** Coordinador, Director Operativo y Administrador.
**Dónde está:** menú → **Turnos** (`/app/turnos`). Título: **"Turnos y overrides"**.

**Plantillas de turno:**

Una plantilla define un horario que se repite. Campos de **"Crear plantilla de turno"**:

- **"Cuadrilla"**: opcional. Con cuadrilla, la plantilla crea turnos para los miembros vigentes de esa cuadrilla.
- **"Nombre"**, **"Descanso (minutos)"** (de 0 a 480), **"Hora de inicio"** y **"Hora de fin"**.
- **"Días de la semana"**, **"Vigente desde"** y **"Vigente hasta"** (opcional).

Pulsa **"Crear plantilla"**. Verás: "Plantilla «[nombre]» creada y lista para usarse en un turno."

> **Atención:** cada día, el sistema genera los turnos automáticamente según las plantillas vigentes. Con cuadrilla, se crean para sus miembros. **Sin cuadrilla, se crean para todos los operadores activos.** Revisa bien este punto antes de crear una plantilla sin cuadrilla.

**Turno puntual:**

Usa **"Crear turno"** para un caso específico:

1. Elige el **"Operador"**, la **"Fecha operativa"**, el **"Inicio"** y el **"Fin"** (hora de Bogotá).
2. Opcionalmente, elige una **"Plantilla"** y escribe **"Notas"**.
3. Pulsa **"Crear turno"**. Verás: "Turno creado y disponible para las asignaciones de perfiles."

**Overrides (excepciones aprobadas):**

Un override permite que un operador trabaje fuera de su ventana, por ejemplo una hora extra. Mientras el override esté vigente, también puede entrar al sistema en ese rango.

1. En **"Crear override"**, elige el **"Operador"**, el **"Tipo"** (**"Hora extra"**, **"Turno extendido"** o **"Permiso especial"**), **"Desde"** y **"Hasta"**.
2. Escribe el **"Motivo"**. Es obligatorio.
3. Pulsa **"Crear override"**. Verás: "Override creado y auditado."
4. Para anularlo, búscalo en **"Overrides creados en esta sesión"** y pulsa **"Revocar"**.

> El registro de horas extra existe, pero **todavía no se liquida en la nómina** (ver [sección 7](#7-limitaciones-actuales--pendiente)).

### 4.12 Icebreakers: revisión de infracciones y reglas

**Quién lo usa:** revisión, Coordinador, Director Operativo y Administrador. Reglas, solo Administrador.
**Dónde está:** menú → **Icebreakers** (`/app/icebreakers-revision`). Título: **"Revisión de icebreakers"**.

**Revisar una infracción:**

1. Filtra por **"Desde"**, **"Hasta"** y **"Estado"**: **"Pendientes"** (predeterminado), **"Revisadas"** o **"Todas"**.
2. En la fila pendiente, pulsa **"Revisar"**.
3. Elige el **"Veredicto"**:
   - **"Incumplimiento confirmado"**: la norma se incumplió.
   - **"Falso positivo"**: la norma se activó sin razón.
   - **"Autorizar publicación"**: el texto se aprueba aunque tenga la alerta. Cambia el icebreaker a **Aprobado**.
4. Escribe el motivo en el campo **"Motivo de la decisión"** (es la justificación; obligatoria, máximo 1000 caracteres).
5. Pulsa **"Guardar"**. Verás: "Revisión registrada ([veredicto])."

> Cada decisión queda registrada con su motivo. Quién puede tomar cada tipo de decisión está pendiente de definir (ver [sección 7](#7-limitaciones-actuales--pendiente)).

**Administrar reglas (Administrador):**

En la sección **"Reglas de TalkyTimes"**:

- **Crear:** completa **"Código"** (se guarda en mayúsculas), **"Nombre"**, **"Tipo"** (**"Palabra clave"**, **"Expresión regular"** o **"Revisión manual"**), **"Patrón"** (no aplica a revisión manual) y **"Severidad"** (**"Bloqueante"**, **"Advertencia"** o **"Informativa"**). Pulsa **"Crear regla"**.
- **Editar:** pulsa **"Editar"** para cambiar nombre, tipo, patrón o severidad. El código no se cambia.
- **Pausar o activar:** **"Pausar"** deja de aplicar la regla a los textos nuevos; **"Activar"** la vuelve a aplicar.

> El catálogo definitivo de normas de TalkyTimes está pendiente (ver [sección 7](#7-limitaciones-actuales--pendiente)).

### 4.13 Mensajes programados (Rocket.Chat)

**Quién lo usa:** Coordinador, Director Operativo y Administrador.
**Dónde está:** menú → **Mensajes** (`/app/mensajes`). Título: **"Mensajes programados"**.

**Cómo programar un mensaje:**

1. En **"Destino"**, elige **"Canal"** u **"Operador"**.
2. Elige el **"Canal"** de la lista o el **"Operador"**.
3. Indica el **"Envío (hora de Bogotá)"**.
4. En **"Repetición"**, elige **"Una vez"**, **"Cada día"** o **"Semanal"**.
   - Para repetir, puedes indicar **"Repetir hasta (incluido)"**.
   - Si es **"Semanal"**, marca los días de la semana. El primer envío debe caer en uno de ellos.
5. Escribe el **"Mensaje"** (máximo 4000 caracteres).
6. Pulsa **"Programar"**. Verás: "Mensaje programado para su envío por Rocket.Chat." o, en una serie, "Serie programada. Cada ocurrencia se entrega por Rocket.Chat."

**Cola e historial:** en **"Mensajes de la serie"** ves cada mensaje con su destino, su repetición, su hora, su estado y su último error si lo hubo.

| Estado | Significado |
|---|---|
| Programado | Pendiente de envío. Se puede cancelar. |
| En cola | En proceso de entrega. |
| Enviado | Entregado. |
| Falló | No se pudo entregar. Revisa el error de la fila. |
| Omitido | No se envió en esa ocurrencia. |
| Cancelado | Cancelado antes del envío. |

**Cancelar:** pulsa **"Cancelar"** en un mensaje **Programado**. En una serie, se cancelan las ocurrencias pendientes: verás "Serie cancelada: no se enviarán más ocurrencias.".

> Si la lista de canales está vacía, no hay canal que elegir. La creación de canales no tiene pantalla en Agency OS (ver [sección 7](#7-limitaciones-actuales--pendiente)).

### 4.14 Nómina

**Quién lo usa:** Director Operativo y Administrador (ver). Solo el Administrador puede exportar.
**Dónde está:** menú → **Nómina** (`/app/nomina`). Título: **"Periodos de nómina"**.

**Qué ves:** la lista de periodos, con **Periodo**, **Rango** de fechas y **Estado** (**Abierto**, **Bloqueado**, **Cerrado** o **Pagado**).

**Cómo ver el detalle:**

1. En el periodo, pulsa **"Ver líneas"**.
2. Verás la tabla **"Líneas calculadas · [periodo]"** con **Operador**, **Puntos**, **Neto COP**, **Cafetería COP** (el descuento por consumo) y **Estado**.

> En la columna **Operador** se muestran solo los primeros 8 caracteres del identificador, no el nombre (ver [sección 7](#7-limitaciones-actuales--pendiente)).

**Cómo exportar a Excel (Administrador):**

1. En el periodo, pulsa **"Exportar Excel (.xlsx)"**.
2. El archivo se descarga con un nombre del tipo **payroll-[inicio]_[fin].xlsx**. Verás: "Archivo [nombre] descargado correctamente."
3. Según la pantalla, el archivo incluye el resumen del periodo, los ajustes y los descuentos de cafetería.

> Las fórmulas de cálculo están pendientes de confirmación (ver [sección 7](#7-limitaciones-actuales--pendiente)). Crear, calcular, bloquear o cerrar un periodo **no tiene pantalla**: lo hace administración técnica.

### 4.15 Cafetería: pedidos de cocina

**Quién lo usa:** Cafetería.
**Dónde está:** menú → **Pedidos** (`/app/pedidos`). Título: **"Pedidos de hoy"**.

**Qué es:** un tablero con cuatro columnas: **"Recibidos"**, **"Aceptados"**, **"En preparación"** y **"Listos"**. Cada tarjeta muestra el número del pedido (#), la hora, las cantidades y los productos, las notas y el total.

**Cómo avanzar un pedido:**

| Estado actual | Botón | Resultado |
|---|---|---|
| Recibido | **"Pasar a aceptados"** | El pedido pasa a Aceptados. |
| Aceptado | **"Pasar a en preparación"** | El pedido pasa a En preparación. |
| En preparación | **"Pasar a listos"** | El pedido pasa a Listos. |
| Listo | **"Entregar"** | El pedido se entrega y se descuenta de la cuenta de la operadora. |

**Qué tener en cuenta:**

- La pantalla se actualiza sola cuando entran o cambian pedidos. Pulsa **"Actualizar ↻"** si lo necesitas.
- Los pedidos entregados, cancelados o expirados salen del tablero.
- Si un pedido **Listo** no se retira antes de su límite de retiro, pasa a **Expirado**. Un pedido expirado no genera descuento.
- Si otra persona cambió el mismo pedido antes que tú, verás: "Otro usuario ya actualizó este pedido. Recargamos la lista."

> No hay botón para cancelar un pedido desde la pantalla (ver [sección 7](#7-limitaciones-actuales--pendiente)).

### 4.16 Cafetería: menú de hoy

**Quién lo usa:** Cafetería.
**Dónde está:** menú → **Menú** (`/app/menu`). Título: **"Menú de hoy"**.

Es una vista de solo lectura de los productos disponibles: nombre, categoría, precio, tiempo de preparación (o "Disponible"). Para pausar o activar un producto, usa **Inventario** ([4.18](#418-cafetería-inventario)).

### 4.17 Cafetería: ventas

**Quién lo usa:** Cafetería, Director Operativo y Administrador.
**Dónde está:** menú → **Ventas** (`/app/ventas`). Título: **"Ventas de cafetería"**.

**Cómo consultar:**

1. Elige **"Desde"** y **"Hasta"**. Por defecto, hoy (hora de Bogotá).
2. Filtra por **"Estado"**: **"Todos los estados"**, **"Entregados"**, **"Cancelados"**, **"Expirados"**, **"Recibidos"**, **"Aceptados"**, **"En preparación"** o **"Listos"**.

**Qué ves:**

- **"Pedidos en rango"**, **"Ventas entregadas"**, **"Ticket promedio"** y **"Cancelados / expirados"**.
- **"Más vendidos"**: los productos con más unidades y su ingreso.
- La tabla **"Historial de pedidos de cafetería"**: **Pedido**, **Fecha**, **Operador**, **Detalle**, **Estado** y **Total**.

Si el rango tiene más de 500 pedidos, la tabla muestra los 500 más recientes y avisa: "La tabla muestra los 500 pedidos más recientes del rango. Los totales de arriba incluyen todos los pedidos."

### 4.18 Cafetería: inventario

**Quién lo usa:** Cafetería, Director Operativo y Administrador.
**Dónde está:** menú → **Inventario** (`/app/inventario`). Título: **"Inventario y disponibilidad"**.

**Crear un producto:**

1. En **"Nuevo producto"**, completa:
   - **"SKU"** (código único, por ejemplo CAF-01)
   - **"Nombre"**
   - **"Categoría"**
   - **"Precio (COP)"**
   - **"Preparación (min)"** (opcional, de 0 a 1440)
   - **"Retiro máx. (min)"** (de 1 a 1440; por defecto **30**)
2. Pulsa **"Agregar producto"**. Verás: "Producto [nombre] creado en el catálogo."

**Editar un producto:**

1. Pulsa **"Editar"** en la fila.
2. Cambia **categoría**, **precio**, **preparación** o **retiro máximo**. Si dejas vacía la preparación, se conserva el valor anterior.
3. Pulsa **"Guardar"**. Verás: "[producto] actualizado."

**Pausar o activar:**

- **"Pausar"** saca el producto del menú de los operadores. **"Activar"** lo vuelve a publicar.
- Verás: "[producto] quedó pausado." o "[producto] quedó disponible."

> El SKU no se puede cambiar desde la pantalla.

### 4.19 Auditoría

**Quién lo usa:** Coordinador, Director Operativo y Administrador. Solo lectura.
**Dónde está:** menú → **Auditoría** (`/app/auditoria`). Título: **"Panel de auditoría"**.

**Qué es:** el registro de acciones del sistema: quién hizo qué, desde dónde y con qué resultado. Es una bitácora que no se modifica. Las credenciales y los tokens **nunca** se muestran.

**Cómo buscar:**

1. Elige **"Desde"**, **"Hasta"**, **"Acción"** y **"Actor"**.
2. Pulsa **"Aplicar filtros ↗"**. Para quitar los filtros, pulsa **"Limpiar"**.
3. Pulsa **"Cargar eventos anteriores ↓"** para ver más.

**Columnas:** **Evento** (acción y entidad), **Actor** (Usuario, Dispositivo, Proceso, Sistema o Anónimo), **Resultado** (**Exitoso**, **Denegado** o **Fallido**), **Origen** (IP y solicitud) y **Momento**.

> **Denegado** significa que el sistema bloqueó el intento, por ejemplo por falta de permiso o por estar fuera de turno.

### 4.20 Seguridad: estado, alertas y estaciones (Administrador)

**Quién lo usa:** Administrador.
**Dónde está:** menú → **Seguridad** (`/app/seguridad`). Título: **"Estado de seguridad"**.

**Qué ves:**

- Un distintivo **"Sistema listo"** o **"Revisar estado"**, con el número de dependencias listas.
- **"Estaciones aprobadas"** y cuántas tienen señal reciente (menos de 15 minutos).
- **"Alertas de abuso"** del vault: marca cada una como **"Marcar como leída"** después de revisarla.
- **"Dispositivos enrolados"**: estación, tipo (**Administrativo** o **Estación**), estado (**Aprobado**, **Pendiente** o **Revocado**), certificado (huella abreviada y vencimiento) y última señal.

**Cómo revocar una estación:**

1. En la fila, pulsa **"Revocar"**.
2. Pulsa **"Confirmar revocación"** (o **"Cancelar"**).
3. Verás: "[estación] quedó revocado. Su certificado ya no autoriza ninguna operación."

> Revocar es una acción sensible. La pantalla no tiene botón para volver a aprobar la estación: confirma con administración técnica antes de hacerlo.

### 4.21 Acceso por IP (Administrador)

**Quién lo usa:** Administrador.
**Dónde está:** menú → **Acceso por IP** (`/app/acceso-ip`). Título: **"Allowlist IP"**.

**Qué es:** la lista de redes autorizadas para entrar a Agency OS. Protege el acceso que no usa certificado de equipo, como el inicio de sesión. Las PC aprobadas con certificado no dependen de esta lista.

**Cómo agregar una red:**

1. Pulsa **"Agregar red +"**.
2. Completa **"Etiqueta"** (por ejemplo, "Oficina principal"), **"Red CIDR"** (por ejemplo, 203.0.113.10/32), **"Alcance"** (**"Toda la operación"**, **"Rol específico"** o **"Usuario específico"**) y, si aplica, el rol o usuario. El **"Vencimiento"** es opcional.
3. Pulsa **"Crear regla ↗"**. Verás: "Regla IP creada y auditada."

**Cómo deshabilitar una red:**

- Pulsa **"Deshabilitar"**. El sistema no permite deshabilitar **la última regla activa**. Agrega y verifica la nueva red antes de retirar la anterior.

### 4.22 Entregas: cola de Rocket.Chat (Administrador)

**Quién lo usa:** Administrador.
**Dónde está:** menú → **Entregas** (`/app/entregas`). Título: **"Cola de entregas"**.

**Qué es:** la cola de avisos que Agency OS envía a Rocket.Chat. Cada aviso se reintenta solo. Tras **8 intentos** queda como **"Sin entregar"** hasta que alguien lo reintente aquí. El contenido de los mensajes no se muestra.

**Cómo reintentar:**

1. Filtra por **"Estado"** (por defecto, **"Sin entregar"**).
2. En la fila, pulsa **"Reintentar"**. Verás: "La entrega #[número] volvió a la cola con sus intentos en cero."

**Resumen:** tarjetas de **"Sin entregar"**, **"En cola o reintentando"** y **"Jobs fallidos"**. La sección **"Jobs fallidos"** es de solo lectura.

---

## 5. Flujos completos

### 5.0 El turno de un operador

Este es el recorrido completo de un turno, de principio a fin.

**Antes del turno (coordinación)**

1. Coordinación crea la **plantilla** o el **turno** y la **asignación** del perfil ([4.9](#49-asignaciones-y-relevos), [4.11](#411-turnos-plantillas-y-overrides)).

**Inicio de sesión**

2. Entras a Agency OS **dentro de tu ventana de turno** ([3.1](#31-iniciar-sesión)).
3. Si es tu primer acceso, cambias la contraseña ([3.2](#32-cambio-de-contraseña-obligatorio-primer-acceso)).

**Inicio del turno**

4. En **"Mi turno"**, pulsas **"Iniciar turno"** dentro de la ventana programada ([4.2](#42-mi-turno-inicio-de-turno-y-breaks)).

**Apertura de perfiles**

5. En **"Mis perfiles"**, pulsas **"Abrir perfil ↗"** ([4.1](#41-mis-perfiles-abrir-y-continuar-un-perfil)).
6. Se abre Chrome en TalkyTimes con el perfil correcto y el agente local entra por ti.
7. Trabajas el perfil. Si vuelves a la aplicación, pulsas **"Continuar ↗"**.

**Breaks**

8. Dentro de cada ventana de 4 horas, puedes tomar **un** break de hasta **20 minutos** con **"Iniciar break"** ([4.2](#42-mi-turno-inicio-de-turno-y-breaks)).

**Icebreakers**

9. Redactas, evalúas y, si quedan aprobados, publicas tus icebreakers en **"Icebreakers"** ([4.3](#43-mis-icebreakers-operador)).

**Cafetería**

10. Pides en **"Cafetería"** durante tu turno ([4.4](#44-pedir-a-cafetería-operador)). Sigues su estado en **"Mis pedidos"** y puedes cancelarlo mientras esté **Recibido**. Cuando el pedido se entrega, se descuenta de tu cuenta del mes.

**Relevo**

11. Si otra persona toma el perfil, el relevo se registra por la asignación. La sesión de la persona saliente se cierra. Tú no tienes que hacer nada más en ese perfil.

**Cierre**

12. El turno se cierra **solo** a su hora programada. Los breaks abiertos se cierran con él.
13. Cierra cada perfil con **"Cerrar"** antes de salir.
14. Cierra tu sesión de Agency OS si compartes la PC, con **"Cerrar sesión"**.

---

### 5.1 Alta de un operador nuevo, de principio a fin

Este recorrido involucra a varios roles. Hazlo en este orden: si falta un paso, el operador no podrá abrir sus perfiles.

1. **Administrador:** crea el usuario con el rol **Operador** en **Usuarios** ([4.7](#47-usuarios-y-roles)) y entrégale la contraseña inicial por un canal privado.
2. **Coordinador, Director o Administrador:** agrega al operador a su cuadrilla en **Cuadrillas** ([4.10](#410-cuadrillas)).
3. **Coordinador, Director o Administrador:** confirma que tiene turnos. Si su cuadrilla tiene una plantilla vigente, los turnos se generan solos; si no, crea un turno puntual en **Turnos** ([4.11](#411-turnos-plantillas-y-overrides)).
4. **Coordinador, Director o Administrador:** revisa en **Perfiles** que cada perfil que trabajará tenga carpeta de Chrome vinculada y credencial **"Configurada"** ([4.8](#48-perfiles-talkytimes-catálogo-y-credenciales)).
5. **Coordinador, Director o Administrador:** crea la asignación de esos perfiles al operador en **Asignaciones** ([4.9](#49-asignaciones-y-relevos)).
6. **Administración técnica:** confirma que la PC donde trabajará está aprobada en **Seguridad** y tiene la extensión y el helper instalados ([9.1](#91-alta-de-una-pc-de-oficina), [9.2](#92-instalación-de-la-extensión-y-del-helper)).
7. **Operador:** entra dentro de su ventana de turno, cambia la contraseña y abre un perfil de prueba ([3.2](#32-cambio-de-contraseña-obligatorio-primer-acceso), [4.1](#41-mis-perfiles-abrir-y-continuar-un-perfil)).

### 5.2 Baja de un operador

1. **Coordinador, Director o Administrador:** finaliza sus asignaciones activas en **Asignaciones**. Sus sesiones abiertas se cierran.
2. **Coordinador, Director o Administrador:** quítalo de su cuadrilla en **Cuadrillas** para que las plantillas dejen de generarle turnos.
3. **Administrador:** deshabilita el usuario en **Usuarios**. Desde ese momento no puede entrar.
4. **Administrador:** si el operador tenía acceso a contraseñas por otra vía, actualiza la credencial de sus perfiles en **Perfiles** con **"Actualizar clave"**.

### 5.3 Cierre del día en cafetería

1. **Cafetería:** entrega o deja expirar los pedidos que quedan en **Listos** ([4.15](#415-cafetería-pedidos-de-cocina)).
2. **Cafetería:** en **Ventas**, deja el rango en el día de hoy y revisa **"Ventas entregadas"** y **"Cancelados / expirados"** ([4.17](#417-cafetería-ventas)).
3. **Cafetería:** en **Inventario**, pausa los productos agotados para que no aparezcan al día siguiente ([4.18](#418-cafetería-inventario)).

### 5.4 Una PC de oficina se pierde, se cambia o su certificado vence

1. **Administrador:** revoca la estación en **Seguridad** si la PC se perdió o dejará de usarse ([4.20](#420-seguridad-estado-alertas-y-estaciones-administrador)). Las sesiones de esa PC dejan de autorizarse.
2. **Administrador:** revisa la fecha de **vencimiento del certificado** en la misma tabla y pide a administración técnica que lo renueve antes de esa fecha. La renovación no tiene pantalla. Una PC con el certificado vencido no puede abrir perfiles.
3. **Administración técnica:** enrola la PC nueva siguiendo el apéndice [9.1](#91-alta-de-una-pc-de-oficina).

## 6. Preguntas frecuentes y solución de problemas

### 6.1 Entrar al sistema

| Mensaje o síntoma | Qué significa | Qué hacer |
|---|---|---|
| "El correo o la contraseña no son correctos." | Los datos no coinciden. También aparece si la cuenta está deshabilitada. | Revisa el correo y la contraseña. Si sigue fallando, pide a administración que revise tu cuenta. |
| "Hay demasiados intentos. Espera unos minutos y vuelve a intentarlo." | Se alcanzó el límite de intentos. Tras 5 contraseñas incorrectas, la cuenta se bloquea 15 minutos. | Espera unos minutos antes de volver a intentarlo. |
| "Tu cuenta no tiene acceso a este momento operativo." | En el caso de operadores, no tienes turno programado ni excepción vigente en este momento. | Entra dentro de tu ventana de turno. Si crees que es un error, avisa a coordinación. |
| "No pudimos conectar con Agency OS. Intenta de nuevo." | Hubo un problema de conexión con el servicio. | Revisa tu conexión y vuelve a intentarlo. |
| "Estamos verificando tu acceso." | El servicio no respondió al verificar tu sesión. | Pulsa **"Reintentar conexión"**. No necesitas escribir tu contraseña otra vez. |
| "Las contraseñas nuevas no coinciden." | En el cambio de contraseña, las dos nuevas no son iguales. | Escríbelas de nuevo con cuidado. |
| "Contacta a coordinación para recuperar el acceso a tu cuenta." | Pediste recuperar la contraseña desde la pantalla de inicio. | Pide a administración que la restablezca. |

### 6.2 Abrir perfiles

| Mensaje o síntoma | Qué significa | Qué hacer |
|---|---|---|
| "La extensión segura no está disponible en este navegador." | El navegador donde abriste la aplicación no tiene la extensión. | Usa el Chrome de la PC de oficina aprobada. |
| "La extensión segura no está configurada en este equipo." | La PC no tiene la configuración de la extensión. | Avisa a administración técnica. |
| "La extensión segura no respondió." | La extensión no contestó. | Reintenta una vez. Si se repite, avisa a administración técnica. |
| "El agente local no está configurado en este navegador." / "No pudimos conectar con el agente local." | La PC no tiene el agente local activo. | Avisa a administración técnica. |
| "Profile already has a live session" (en inglés) | Otra persona tiene el perfil abierto. | Coordina con esa persona antes de abrirlo. |
| "Session was prepared by a different station" (en inglés) | La sesión fue preparada desde otra PC. | Abre el perfil desde la PC que lo preparó, o pide a coordinación que lo revise. |
| "Chrome profile binding does not match profile configuration" (en inglés) | La carpeta de Chrome del perfil no coincide con la configurada. | Avisa a coordinación: la carpeta del perfil debe revisarse en **Perfiles**. |
| "Operator is outside an approved shift" (en inglés) | No estás en tu ventana de turno. | Abre el perfil durante tu turno. |
| "An approved station device is required" (en inglés) | La PC desde la que intentas abrir el perfil no está aprobada. | Usa una PC aprobada. Si debería estarlo, avisa a administración. |

### 6.3 Turno y breaks

| Mensaje o síntoma | Qué significa | Qué hacer |
|---|---|---|
| "No tienes un turno en este horario." | No hay turno programado para este momento. | Revisa tu horario con coordinación. |
| "Ya tomaste el break de esta ventana." | Ya tomaste el break de la ventana actual. | Espera a la siguiente ventana, si la hay. |
| "Las ventanas de break de este turno ya pasaron." | El turno ya no tiene ventanas disponibles. | No hay acción posible en este turno. |
| "No shift in progress" (en inglés) | Intentaste un break sin turno en curso. | Pulsa **"Iniciar turno"** primero. |
| "Shift not found or already started" (en inglés) | El turno ya estaba iniciado o no está en su ventana. | Recarga **"Mi turno"**. |
| "Break changed concurrently" (en inglés) | El break cambió mientras lo modificabas. | Pulsa **"Actualizar ↻"** y revisa el estado. |

### 6.4 Icebreakers, pedidos y cafetería

| Mensaje o síntoma | Qué significa | Qué hacer |
|---|---|---|
| "Otro usuario ya actualizó este pedido. Recargamos la lista." | Otra persona de cocina movió el pedido primero. | Revisa el tablero actualizado. |
| "Cannot move order from [estado] to [estado]" (en inglés) | Ese cambio de estado no está permitido. | Avanza el pedido paso a paso según el botón. |
| "The profile is not assigned to you right now" (en inglés, al publicar un icebreaker) | El perfil del icebreaker ya no está asignado a tu turno. | Publícalo solo si el perfil vuelve a estar asignado, o pide a coordinación que revise la asignación. |
| "No pudimos actualizar el pedido." | El cambio no se guardó. | Pulsa **"Actualizar ↻"** e intenta de nuevo. |
| "Bloqueado: incumple las normas de TalkyTimes y no se puede publicar." | El texto infringe una norma activa. | Pulsa **"Editar"**, corrige el texto y vuelve a **"Evaluar"**. |
| "Aprobado con advertencias: ya puedes publicarlo." | El texto cumple, pero tiene observaciones. | Revisa las advertencias y decide si publicas. |

### 6.5 Sesión y equipo

| Síntoma | Qué significa | Qué hacer |
|---|---|---|
| La fila dice "Sesión vencida; reabrir". | La PC dejó de enviar señal durante la sesión. | Pulsa **"Abrir perfil ↗"**. |
| Tu cuenta se cierra al terminar el turno. | Es el comportamiento esperado para operadores. | Vuelve a entrar en tu siguiente turno. |
| El semáforo muestra "último snapshot". | La pantalla no está recibiendo cambios en vivo. | Pulsa **"Actualizar ↻"**. |

---

## 7. Limitaciones actuales / pendiente

Esta sección es importante para no esperar funciones que todavía no existen. Cada punto indica qué falta y, cuando aplica, qué decisión está pendiente con la clienta.

### 7.1 Nómina

- **Fórmulas pendientes:** las reglas exactas de bonos, metas, días trabajados y eventos dinámicos siguen abiertas (pregunta OQ-09). Hasta confirmarlas, los importes de nómina no son definitivos.
- **Interpretación de FR-28 pendiente:** no está confirmado si el operador debe ver sus puntos ya multiplicados por su comisión o sus puntos brutos.
- **Comisión no configurada:** hoy el cálculo se detiene e indica qué operadores no tienen comisión configurada; nunca paga el 100% por defecto. Pendiente de confirmación por la clienta.
- **Cambio de comisión a mitad de mes:** hoy cada día del periodo se liquida con la comisión y la tasa vigentes ese día. Pendiente de confirmación por la clienta.
- **Tasa general por periodo:** pendiente de decidir si se necesita.
- **Saldo negativo por consumo de cafetería:** si el consumo supera lo ganado, el total queda negativo. No se arrastra al periodo siguiente ni tiene tope. Pendiente de decidir.
- **Crear, calcular, bloquear y cerrar un periodo** no tiene pantalla. Lo hace administración técnica.
- **Mi nómina sin descuentos:** la pantalla del operador muestra puntos y pago estimado, pero no el descuento de cafetería ni los ajustes del periodo.
- **Nombre del operador en las líneas:** se ven los primeros 8 caracteres del identificador.
- **Horas extra:** el registro existe, pero el cálculo en nómina todavía no está hecho.
- **Competencias:** existe una tabla de posiciones básica en el sistema, sin pantalla propia.

### 7.2 Tableau y puntos por hora

- **Puntos por hora pendientes:** los datos actuales de Tableau son de resumen. Para repartir puntos entre turnos hace falta una hoja plana por perfil y hora, su zona horaria y la hora de actualización (preguntas del bloque 1 de la clienta).
- **Sin pantalla de Tableau:** la gestión de vistas y actualizaciones está disponible solo para administración técnica.
- **Actualización diaria:** el proceso automático está previsto para las 09:15 con los datos del día anterior. Esa hora depende de Tableau y está pendiente de confirmar.

### 7.3 Icebreakers

- **Normas de TalkyTimes:** el catálogo definitivo de normas está pendiente. Mientras tanto, el sistema aplica las reglas que estén cargadas y activas.
- **Puntaje mínimo:** no está definido si un puntaje bajo bloquea la publicación.
- **Flujo de aprobación:** no está definido si un icebreaker aprobado necesita la aprobación de un coordinador.
- **Quién decide los falsos positivos:** pendiente de definir entre coordinación, Dirección Operativo o ambos.
- **Envío a TalkyTimes:** "Publicar" registra el icebreaker en Agency OS, pero no lo envía a TalkyTimes.
- **Motor de IA:** es opcional. Si no está configurado, solo se aplican las reglas locales.

### 7.4 Cafetería

- **Historial de pedidos:** el operador ve solo sus 10 pedidos más recientes.
- **Cancelar un pedido aceptado:** solo cafetería puede hacerlo. El operador cancela únicamente pedidos en estado Recibido.

### 7.5 Perfiles, sesiones y accesos

- **Restablecer contraseñas:** la pantalla de inicio solo remite a coordinación, y la pantalla de usuarios no tiene botón para restablecer. Lo hace administración técnica.
- **Alerta del operador:** el semáforo puede mostrar "Alerta", pero la operadora no tiene un botón para declararla. Hoy se hace por administración técnica.
- **Terminar un turno a mano:** el turno se cierra solo a su hora programada. No hay botón para hacerlo antes.
- **Recordar sesión:** la casilla de la pantalla de inicio no tiene función.

### 7.6 Comunicación

- **Canales de Rocket.Chat:** su creación y mantenimiento no tienen pantalla.
- **Mensajes inmediatos:** solo hay mensajes programados en la web.
- **Base de conocimiento y bot:** no tienen pantalla en la aplicación web.

### 7.7 Funciones no disponibles

- **Traductor:** no está construido.
- **Interacciones por país:** están bloqueadas por una decisión externa y no están disponibles.
- **Alta de estaciones y códigos de enrolamiento:** no tienen pantalla. Lo hace administración técnica.
- **Tarifas por operador y compensación:** no tienen pantalla. Lo hace administración técnica.
- **Configuración y banderas de funcionalidad:** no tienen pantalla.

### 7.8 Idioma y disponibilidad

- **Mensajes en inglés:** algunos mensajes de reglas de negocio llegan del servidor en inglés tal como están escritos. Están recogidos en la [sección 6](#6-preguntas-frecuentes-y-solución-de-problemas).
- **Alta disponibilidad:** la topología de producción está pendiente de aceptación por escrito. Hoy se plantea arrancar en un solo servidor con copias de seguridad externas.
- **Métricas y datos de rendimiento:** la captura de métricas de negocio todavía está en curso.

---

## 8. Glosario

| Término | Significado |
|---|---|
| **Asignación** | Relación entre un perfil, un operador y una franja horaria, con sus días y su vigencia. |
| **Break** | Descanso dentro del turno. Se toma en una ventana de 4 horas y dura como máximo 20 minutos. |
| **Ventana de break** | Cada uno de los dos intervalos de 4 horas en que se puede tomar un break, contados desde la hora programada del turno. |
| **Cafetería (KDS)** | Pantalla de cocina con los pedidos por estado. KDS significa *Kitchen Display System*. |
| **Certificado de equipo** | Identidad de una PC aprobada, emitida por administración. Identifica la PC, no a la persona. |
| **Coordinador** | Rol que gestiona la cobertura, el equipo y las cuadrillas que tiene a cargo. |
| **Cuadrilla** | Grupo de operadores con un coordinador responsable. |
| **Director Operativo** | Rol con visión global de la operación. |
| **Estación** | Una PC de oficina registrada y aprobada. |
| **Extensión** | Extensión de Chrome que completa el ingreso a TalkyTimes sin mostrar la contraseña. |
| **Helper local / agente local** | Programa de la PC que abre Chrome con el perfil correcto. |
| **Icebreaker** | Mensaje de apertura para un perfil de TalkyTimes. Se evalúa contra las normas antes de publicarse. |
| **Infracción** | Caso en el que un icebreaker incumple una norma activa. |
| **Norma o regla** | Criterio que evalúa un icebreaker. Puede ser de palabra clave, de expresión regular o de revisión manual, y tener severidad bloqueante, de advertencia o informativa. |
| **Operador** | Rol de la persona que atiende los perfiles en su turno. |
| **Override** | Excepción aprobada que amplía la ventana de un operador, por ejemplo una hora extra. |
| **Perfil (TalkyTimes)** | Cuenta de TalkyTimes que administra la agencia. |
| **Perfil de Chrome** | Carpeta del navegador (Default o Profile 1 a 8) que aísla las cookies de cada cuenta. |
| **Pedido** | Solicitud de un operador a cafetería. |
| **Período de nómina** | Rango de fechas que se liquida junto. |
| **Puntos** | Unidad de desempeño que se convierte en pesos colombianos para la nómina. |
| **Relevo** | Paso de un perfil de un operador a otro al terminar una asignación. |
| **Semáforo** | Vista del equipo con el estado de cada operador. |
| **Sesión (de perfil)** | Apertura de un perfil en un turno. En pantalla se muestra como *Abriendo perfil*, *Sesión activa*, *Reintento disponible* (con error), *Sesión vencida; reabrir* o *Disponible* (cerrada o sin sesión). |
| **Turno** | Jornada programada de un operador, con su hora de inicio y fin. |
| **Vault (bóveda)** | Almacén cifrado de las credenciales de los perfiles. La contraseña nunca se muestra. |

---

## 9. Apéndice: administración técnica

> Esta sección es para el equipo técnico o de administración. Las operadoras y los demás roles no necesitan leerla.

### 9.1 Alta de una PC de oficina

1. Administración crea el registro de la estación. El sistema genera un **código de un solo uso** con vencimiento. Este paso no tiene pantalla: se hace por la API.
2. En la PC, el instalador del helper canjea el código y presenta el **certificado de equipo** de esa PC.
3. El sistema registra la **huella** del certificado. No se guarda ningún secreto.
4. En **Seguridad** la estación aparece con su estado (**Pendiente**, **Aprobado** o **Revocado**). Desde ahí también se puede revocar.

### 9.2 Instalación de la extensión y del helper

- La extensión se instala por **política de Chrome** (`ExtensionInstallForcelist`), no a mano en cada perfil. El script `install-managed-policy.ps1` la provisiona con una consola de Windows **elevada**.
- La política administrada define tres valores: `apiBaseUrl` (dirección del API con `/api/v1`), `webAppOrigin` (dirección exacta de la aplicación web) y `nativeHostName` (por defecto, `com.agencyos.helper`).
- El script `install-native-host.ps1` registra el helper para la extensión.
- Verifica que cada perfil de Chrome que se usa en la PC tenga la extensión instalada y habilitada.
- El ID de la extensión debe coincidir con la configuración de la aplicación web (`VITE_EXTENSION_ID`).

### 9.3 Modos de apertura de perfiles

La aplicación web puede abrir perfiles de dos formas, según su configuración:

- **Extensión + helper:** la aplicación envía la orden a la extensión, que pide al helper abrir Chrome con el perfil correcto.
- **Agente local:** si está configurada la variable `VITE_LOCAL_AGENT_URL`, la aplicación habla con el agente local de la PC en lugar de la extensión. En ese modo aparece el botón **"Cerrar"**.

En el modo de agente local, el propio agente completa los campos de TalkyTimes y oculta el botón de ver contraseña; no depende de la extensión.

> **Modo oficial:** producción usa el **agente local** (`VITE_LOCAL_AGENT_URL` en `deploy/production/.env.production`). El agente abre Chrome con el perfil correcto, completa el formulario de TalkyTimes, pulsa el botón de ingreso y cierra el navegador cuando la sesión deja de estar autorizada. El operador no tiene que hacer clic para entrar. Diseño: `tasks/plan-cierre-chrome-automatizado-2026-09-10.md`.

### 9.4 Control de acceso por red y reinicio de sesión

- Las PC aprobadas con certificado **no dependen** de la lista de IP. La lista protege el acceso sin certificado, como el inicio de sesión.
- Por defecto, los operadores solo pueden iniciar sesión dentro de su ventana de turno o con un override vigente. Esto se controla con la variable de configuración `REQUIRE_SHIFT_FOR_AUTH`.
- El límite de intentos de inicio de sesión es de 5 por cuenta y por IP en ventanas de 15 minutos; tras 5 fallos, la cuenta se bloquea 15 minutos.

### 9.5 Tareas que solo se hacen por API

Estas tareas no tienen pantalla y requieren administración técnica:

- Alta de estaciones y códigos de enrolamiento.
- Restablecimiento de contraseñas de usuarios.
- Cálculo, bloqueo y cierre de periodos de nómina; tarifas de compensación; metas y competencias.
- Creación y mantenimiento de canales de Rocket.Chat y mensajes inmediatos.
- Gestión de vistas de Tableau y de la base de conocimiento.
- Cancelación de pedidos ya aceptados (la hace cafetería desde su propio rol).
- Configuración general y banderas de funcionalidad.

---

## Control del documento

- Base: código de la aplicación web y del backend, extensión y helper del repositorio, a fecha **2026-11-25**.
- Revisa este manual después de cada cambio de pantalla, de permisos o de flujo de apertura de perfiles.
- Las limitaciones de la [sección 7](#7-limitaciones-actuales--pendiente) se basan en `tasks/preguntas-cliente-2026-11-22.md` y `odd/tasks/HANDOFF-2026-11-22.md`. Actualízalas cuando la clienta responda.
