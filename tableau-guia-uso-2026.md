# Guía de uso de Tableau 2026 — resumen operativo para Agency OS

> Documento elaborado a partir de la presentación pública de Canva **“Guía de uso inicial — Tableau 2026”**, consultada el 14 de agosto de 2026. Resume el contenido funcional relevante para entender los reportes de la clienta y diseñar la integración de métricas en Agency OS.

**Fuente principal:** [presentación en Canva](https://www.canva.com/design/DAHByry9hzw/nRo6kbpTRFeTRGg4bXVhaQ/view?utm_content=DAHByry9hzw&utm_campaign=designshare&utm_medium=link&utm_source=viewer)

**Cobertura:** 38 diapositivas. La presentación es una guía de uso para socios/agencias, no una especificación técnica de la API ni un diccionario completo de datos.

## 1. Resumen ejecutivo

Tableau es el espacio de análisis estadístico y operativo de la agencia. Los reportes permiten observar ingresos, actividad de perfiles TU, velocidad de respuesta, sesiones en línea, retención de RU, uso de SourceID, conversión de rompehielos y mensajes de Travel Misleading.

La operación se filtra principalmente por:

- rango de fechas;
- agencia y subagencia/panel administrativo;
- zona horaria;
- tipo de ingreso o servicio;
- SourceID;
- perfil o `id_trusted user`;
- inclusión o exclusión del SourceID.

Los reportes no tienen una única frecuencia de actualización:

- algunos se actualizan cada hora concluida;
- otros una vez al día, normalmente con datos del día anterior;
- Connections retention se actualiza cada tercer día.

La presentación insiste en el uso diario de los informes y de los códigos SourceID para identificar la efectividad de cada empleado, detectar problemas de operación y mejorar los ingresos.

## 2. Conceptos y actores

### TU

La presentación usa **TU** para referirse al perfil/asistente personal que opera dentro de la agencia. Los reportes suelen analizar sus métricas por perfil, SourceID o agencia.

### RU

**RU** es el usuario regular que interactúa con un perfil TU. Varias métricas se calculan sobre la relación RU–TU: ingresos por pareja, retención, velocidad de respuesta, límites de conversación y mensajes enviados.

### SourceID

El **SourceID** o código de referencia es un código asignado al asistente personal/TU para identificar asistentes específicos y analizar sus métricas durante los turnos laborales.

Es una dimensión operativa crítica porque permite atribuir ingresos, sesiones, actividad y resultados a una persona o código de turno. La guía recomienda usarlo de forma sistemática.

### Admin y Sub-admin

Los filtros **Admin** y **Sub-admin** representan el panel administrativo principal y un subpanel, si la agencia los tiene. La presentación no documenta el modelo jerárquico exacto ni los valores posibles.

## 3. Acceso y seguridad

### Registro inicial

1. El CSM proporciona un enlace de acceso.
2. El usuario registra nombre, apellido, contraseña y confirmación de contraseña.
3. Tableau redirige al registro de un método de verificación.
4. Se debe seleccionar **Generador de contraseña puntual**.
5. Tableau muestra un código QR.
6. El usuario instala Google Authenticator en iOS o Android.
7. En Google Authenticator selecciona `+` y luego **Escanear un código QR**.
8. Después, accede al portal principal de Tableau e introduce el código temporal de la aplicación.

La guía advierte que el QR está disponible una sola vez. Si varias personas necesitan acceder, recomienda guardar una captura y compartirla únicamente con quienes deban tener acceso.

### Modelo de acceso actual

La presentación afirma que existe un único acceso de Tableau por agencia. Si una agencia tiene varios paneles administrativos, la información se consolida en un mismo espacio y se puede seleccionar uno o varios paneles mediante filtros.

También indica que actualmente no existen accesos separados por persona. Por tanto, quien tiene acceso a Tableau puede potencialmente visualizar la totalidad de los datos disponibles. La guía reconoce esto como una limitación de seguridad y segmentación.

**Implicación para Agency OS:** esta limitación debe considerarse una razón para no exponer Tableau directamente a operadores. La aplicación propia debería aplicar permisos y alcance por rol, agencia, coordinador, perfil o SourceID antes de mostrar métricas.

## 4. Navegación y descarga

### Ubicación de los reportes

La ruta indicada es:

```text
Collections > Reporting
```

También se puede buscar un informe desde la barra de búsqueda ubicada en la parte superior derecha.

### Formatos de descarga

Todos los reportes tienen opciones de descarga en la parte superior derecha:

- **Image:** imagen PNG.
- **Crosstab:** descarga en Excel o CSV.
- **PDF:** archivo PDF.
- **Powerpoint:** archivo PPTX.

Para una integración de datos, la opción más relevante es **Crosstab**, aunque la presentación no confirma límites de filas, paginación, nombres técnicos de columnas ni estabilidad de los archivos exportados.

## 5. Filtros comunes

La siguiente tabla resume los filtros descritos en la diapositiva 8.

| Filtro visible | Función descrita | Dimensión que probablemente representa |
|---|---|---|
| `Date` | Seleccionar un rango de fechas | Fecha de análisis o fecha del evento |
| `Admin` | Seleccionar el panel administrativo principal | Agencia/panel |
| `Sub-admin` | Seleccionar un subpanel cuando aplica | Subagencia/panel secundario |
| `Time zone` | Elegir la zona horaria en que se muestran datos o ingresos | Zona horaria de presentación/corte |
| `Include sourceID` | Incluir o excluir SourceID en la búsqueda | Presencia de atribución por código |
| `Revenue type` | Filtrar por servicios específicos que generaron ingresos | Tipo de servicio/ingreso |
| `Source ID` | Filtrar por uno o varios códigos de referencia | TU, empleado o turno identificado |
| `id_trusted user` | Filtrar por uno o varios ID de TU | Perfil TU |

### Definición operativa de SourceID

La guía lo presenta como el código de referencia que identifica al asistente personal y permite analizar métricas durante sus turnos. En el sistema propio debe conservarse como dimensión independiente, aunque todavía falta confirmar si coincide exactamente con el identificador interno de la operadora, del turno o del perfil TU.

## 6. Zonas horarias

El filtro `Time zone` tiene varias opciones. Las más relevantes son:

- **UTC+0:** zona predeterminada/europea. Tableau utiliza esta zona para los cortes de pago de las agencias; la guía también indica que bonificaciones y programas motivacionales siguen este horario.
- **UTC-5:** horario de Colombia. Se recomienda para monitorear la operación en tiempo real, por ejemplo, sesiones en línea.
- **UTC+2, UTC+3 y UTC+8:** zonas disponibles para otras regiones.

Existe además una regla específica en **Connections retention**: el cálculo del día completo se hace en **UTC-9**, según la presentación porque la mayoría de los usuarios están en Estados Unidos. La guía lo traduce como un inicio aproximado a las 4:00 a. m. de Colombia.

**Regla de diseño:** un dashboard propio no debe almacenar únicamente una fecha sin zona horaria. Debe conservar el instante original y mostrar la zona aplicada al cálculo. En especial, deben separarse:

- fecha/hora del evento en origen;
- fecha/hora de visualización;
- fecha de corte de pago en UTC+0;
- fecha de monitoreo operativo en UTC-5;
- fecha de cálculo de retención en UTC-9.

## 7. Actualización y frescura de la información

La diapositiva 33 aclara que, por defecto, los reportes horarios se actualizan al terminar cada hora completa. Puede existir una diferencia de hasta dos horas entre la hora actual y el último dato disponible.

Ejemplo de la guía: si el reporte se consulta a las 3:45 p. m., la última actualización podría corresponder a las 2:00 p. m.

La presentación explica que Tableau procesa un volumen grande de información y que ocasionalmente puede haber retrasos. Afirma que la información no se pierde porque Tableau captura datos 24/7.

**Consecuencia para Agency OS:** cada métrica importada debe guardar al menos:

- fecha/hora del dato o del intervalo medido;
- fecha/hora de extracción;
- fecha/hora de actualización declarada por Tableau, si está disponible;
- reporte/vista de origen;
- estado de frescura o retraso.

No se debe presentar como “en vivo” un dato cuya fuente se actualiza cada hora, diariamente o cada tercer día.

## 8. Catálogo de reportes

### 8.0 Catálogo visual por categoría

Las diapositivas 34–35 presentan un índice de reportes más usados. Algunos aparecen explicados en esta sección; los demás deben considerarse parte del inventario funcional que conviene validar con la clienta antes de decidir cuáles entran al primer alcance de Agency OS.

#### Reportes: ingresos

- Rev structure.
- Revenue detailed.
- RU–TU interaction.

#### Reportes: regalos

- Pairs “thank you present”.
- Pairs with not used VG from TU.
- Presents for TU.

#### Reportes: generales

- Connections retention.
- Online Sessions.
- Answer speed.
- Partner details.
- Passport.
- TU activity.
- Pairs with late answers.
- Photo list.
- Dynamic Source ID usage.
- List of block pairs.
- Source ID Activity.
- Connections with users.
- Source ID Activity Detailed.

#### Reportes: moderación y contenido multimedia

- Moderation Agency.
- Moderation TU.
- Moderation Decline reasons.
- Failed profiles.
- Plain Avatars.
- TU CTR.

#### Reportes: chat posts

- Chat posts send.
- Pairs with available chat posts.

#### Reportes: rompehielos

- Chat icebreakers send info.
- Correspondence ices conversion.
- Icebreakers with photos.
- Icebreakers without photos.

#### Reportes: límites

- Pairs with not used mail limits.
- Limits usage.
- Pairs with not used limits.
- Data MP dynamic — marcado en la presentación como “irrelevant”.
- Pairs with not used dialogues — marcado en la presentación como “irrelevant”.

#### Reportes: scoring system

- TU structure.
- Scoring board.
- TU Scoring.

#### Reportes: programas de la plataforma

- Chat Request Dashboard.
- Chat Request Content.
- Contact exchange.
- Travel Misleading report for partner.
- Messages TM.

La misma zona de la presentación incluye un índice por frecuencia con reportes de actualización semanal, diaria y horaria. La guía no proporciona una ficha detallada de cada elemento del catálogo, por lo que no debe suponerse la frecuencia de los reportes adicionales sin validar la vista real.

### 8.1 Revenue detailed

**Frecuencia:** cada hora concluida.

**Qué muestra:** ingresos por servicio, perfil TU y SourceID.

**Usos indicados:**

- hacer seguimiento de los ingresos por SourceID durante los turnos;
- controlar los ingresos generados por créditos gratuitos;
- verificar que los créditos gratuitos no superen el nivel deseado, mencionado en la guía como aproximadamente el 10 % de los ingresos totales.

**Componentes y filtros descritos:**

1. **Grand Total:** total de ingresos para la agencia, SourceID o perfil TU.
2. **Revenue type:** ingresos de los servicios seleccionados.
3. **Rango horario:** delimita la búsqueda a un rango de horas.
4. **Credits type:** distingue `Free` y `Paid`.

**Regla temporal:** los cortes de pago se realizan en UTC+0.

**Enlace indicado:** [Revenue detailed](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/Passport_16741406948180/Revenuedetailed?:iid=11)

#### Pronóstico de facturación

La misma vista incluye un pronóstico basado en los ingresos del mes anterior y el progreso del mes actual.

- Verde: incremento pronosticado frente al mes anterior.
- Rojo: decremento pronosticado frente al mes anterior.
- El pronóstico puede analizarse para toda la agencia, por TU o por SourceID.

La presentación no documenta la fórmula, el horizonte exacto ni la definición de “mes anterior”; esos detalles deben validarse con datos de Tableau.

### 8.2 TU activity

**Frecuencia:** una vez al día.

**Qué muestra:** métricas relevantes por perfil TU y una sección de ingresos de la agencia.

La información se muestra según las fechas seleccionadas. Incluye el filtro **TU revenue for period**, que permite elegir el rango de ingresos a mostrar.

El reporte se divide en:

- **TU Metrics:** visibilidad de las métricas más importantes por perfil TU.
- **Agency Revenue:** ingresos de la agencia.

La sección **Dynamic for Agency revenue** presenta una dinámica semanal de ingresos para los perfiles TU seleccionados. Sirve para observar tendencias semana a semana.

**Enlace indicado:** [TU activity](https://prod-uk-a.online.tableau.com#/site/partnerdata/views/Partnerreport/TUactivity?:iid=8)

> El enlace aparece en la presentación sin `/` entre `.com` y `#/site`; debe validarse antes de utilizarlo como URL técnica.

### 8.3 Passport

**Frecuencia:** cada hora concluida.

**Qué muestra:** colección de métricas importantes de la agencia con orientación operativa y de monitoreo.

**Usos indicados:**

- detectar rápidamente caídas;
- observar tendencias generales;
- monitorear ingresos por servicio;
- revisar actividad y velocidad de respuesta.

#### Métricas de ingresos

Las métricas 1 y 2 muestran:

1. ingreso total;
2. ingreso por servicios.

Para cada una se puede observar:

- porcentaje y valor en dólares de alzas o bajas durante el día;
- última hora de actualización;
- tendencia de ingresos de las últimas semanas al pasar sobre las barras.

#### Métrica de actividad

La métrica 3 presenta la curva de actividad de los perfiles durante el día actual.

- Una curva más alta representa mayor actividad.
- Permite comparar el día actual con el mismo día de la semana anterior.
- También muestra índices máximos y mínimos y actividad de RU.

#### Métricas de demora de respuesta

Las métricas 4 y 5 muestran porcentajes de demora general y de los primeros mensajes de RU.

- Una curva más alta significa mayor demora.
- La ausencia de curva significa que no hubo mensajes.
- La recomendación operativa es responder en menos de cinco minutos desde la recepción.

**Enlace indicado:** [Passport](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/Passport_16741406948180/PASSPORT)

### 8.4 Pairs with late answers

**Frecuencia:** una vez al día.

**Qué muestra:** desglose por pareja RU–TU de la velocidad de respuesta en cada diálogo.

**Uso:** detectar parejas con problemas de velocidad y priorizar acciones correctivas.

**Campos descritos:**

| Campo | Significado |
|---|---|
| `date_message` | Fecha y hora en que TU recibió el mensaje |
| `date_answered` | Fecha y hora en que TU respondió |
| `TU_online_status` | Estado en línea/fuera de línea al recibir el mensaje |
| `date_became_online` | Momento en que TU volvió a estar en línea, si recibió el mensaje offline |
| `time to answer (min)` | Minutos hasta recibir respuesta |

Si `date_answered` es `Null`, el mensaje todavía no ha sido respondido.

**Enlace indicado:** [Pairs with late answers](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/Lateanswerslist_16741405736850/Pairswithlateanswers?:iid=1)

### 8.5 TU avatar CTR in Search

**Frecuencia:** una vez al día.

**Qué muestra:** qué avatar funciona mejor para un TU determinado y qué tipos de avatar atraen más a los RU en general.

**CTR — Click Through Rate:** porcentaje de clics que reciben las fotos de avatar. Se utiliza como indicador de atractivo inicial de la imagen.

La columna `URL` puede desplegarse para mostrar dos columnas adicionales con las fechas de actualización de las imágenes.

**Enlace indicado:** [TU avatar CTR](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/TUavatarCTR/TUavatarCTRpartners?:iid=1)

> La diapositiva también contiene un segundo enlace de `Pairs with late answers`, aparentemente no relacionado con este reporte. Conviene confirmar si fue incluido por error.

### 8.6 Scoring Board

**Frecuencia:** una vez al día.

**Conceptos:**

- **Value:** calificación total de las métricas de la agencia.
- **Score:** calificación de cada métrica, comparada con el promedio de la región.

**Objetivos indicados:**

- paneles femeninos: `Value >= 60`;
- paneles masculinos: `Value >= 55`.

La presentación no especifica qué métricas componen el valor total ni los pesos utilizados.

**Enlace indicado:** [Scoring Board](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/ScoringKPI2025/ScoringBoardFTU?:iid=1)

### 8.7 Connections retention

**Frecuencia:** cada tercer día.

**Qué mide:** panorama de la retención de RU regulares por parte de los TU.

La métrica considera que un RU regrese con una acción pagada después de una conexión, según el tiempo de vida seleccionado.

**Componentes descritos:**

1. porcentaje promedio de retención de la agencia;
2. gráfico diario del porcentaje de retención;
3. porcentaje de retención por perfil TU;
4. filtros por tiempo de vida.

**Definiciones:**

- **Total:** suma de diálogos, con el tiempo de vida seleccionado, donde el día anterior hubo interacción pagada.
- **Returned:** suma de esos mismos diálogos donde el día anterior hubo un mensaje o interacción pagada del RU y hoy la conversación se reanudó.

**Filtros de tiempo de vida:**

- todos;
- nuevas: 0 días;
- recientes: 1–7 días;
- antiguas: 8 días o más.

**Zona de cálculo:** el día completo se calcula en UTC-9. La guía indica que esto empieza aproximadamente a las 4:00 a. m. de Colombia.

**Enlace indicado:** [Connections retention](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/Retention_16781838534580/Retentiontotal?:iid=3)

### 8.8 RU–TU interaction

**Frecuencia:** una vez al día, con información del día anterior.

**Qué muestra:** ingresos de las parejas de interacción RU–TU durante el periodo seleccionado.

**Uso:** identificar las parejas que mejor facturan y revisar su desempeño.

**Enlace indicado:** [RU–TU interaction](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/RU-TUinteraction/RU-TUinteraction?:iid=2)

### 8.9 Answer speed

**Frecuencia:** cada hora concluida.

**Qué muestra:** velocidad de respuesta general de la agencia y por perfil o SourceID.

La guía define como objetivo responder el primer mensaje de un RU nuevo durante los primeros cinco minutos.

**Componentes:**

1. porcentaje promedio de rapidez de respuesta de la agencia para el periodo seleccionado;
2. tendencia diaria del promedio, con detalle al pasar sobre cada punto;
3. cantidad de mensajes recibidos por TU o SourceID;
4. porcentaje de esos mensajes respondidos dentro de los primeros cinco minutos.

**Enlace indicado:** [Answer speed](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/Passport_16741406948180/Answerspeed)

> La presentación usa tanto “rapidez de respuesta” como “porcentaje de mensajes respondidos en menos de cinco minutos”. Debe confirmarse si el primer indicador es exactamente el segundo o si es una métrica distinta.

### 8.10 Online sessions

**Frecuencia:** cada hora concluida.

**Qué muestra:** sesiones en línea de la agencia durante el periodo seleccionado, mediante barras interactivas.

**Usos:**

- monitorear turnos;
- asegurar el uso de SourceID.

Al pasar sobre un bloque se observan más detalles de la sesión.

**Reglas visuales indicadas:**

- `Source ID = -1`: la sesión no se realizó con SourceID;
- bloque rojo: actividad del perfil sin SourceID;
- bloque azul: actividad del perfil con SourceID.

**Enlace indicado:** [Online sessions](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/Passport_16741406948180/Onlinesessions?:iid=13)

### 8.11 Pairs with not used limits

**Frecuencia:** una vez al día.

**Qué muestra:** parejas TU–RU cuyos límites de conversación no se utilizaron después de la actualización.

**Uso:** localizar inmediatamente el ID del RU, retomar la conversación y aumentar las posibilidades de crear una conexión.

La vista permite analizar el uso de límites por SourceID.

**Campo descrito:**

- fecha y hora de actualización de los límites.

**Enlace indicado:** [Pairs with not used limits](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/Limitsusage_16741407201760/Pairswithnotusedlimits)

### 8.12 Chat ices conversion

**Frecuencia:** una vez al día.

**Qué muestra:** mensajes de rompehielos enviados. La parte izquierda identifica la agencia y el TU que envió el mensaje.

**Categorías de conversión:**

- todos;
- promedio;
- mejor que el promedio;
- información insuficiente;
- peor que el promedio.

Cada categoría tiene un color asociado en el reporte.

**Enlace indicado:** [Chat ices conversion](http://prod-uk-a.online.tableau.com/#/site/partnerdata/views/ices/Chaticeswithoutphoto?:iid=3)

> La URL está publicada con `http` en lugar de `https`; debe validarse antes de integrarla.

### 8.13 Travel Misleading report

**Frecuencia:** una vez al día.

**Métricas:**

| Métrica | Definición de la guía |
|---|---|
| `% TU with TM case` | Porcentaje de TU que usaron Travel Misleading al menos una vez durante el periodo |
| `% TU with X TM case` | Porcentaje de TU que usaron Travel Misleading X veces; X se define con un filtro |
| `% with days with TM` | Porcentaje de días de conexión con al menos un caso de Travel Misleading |
| `% mess with TM` | Porcentaje de mensajes con Travel Misleading sobre el total de mensajes enviados |
| `total_connection` | Número absoluto de conexiones |
| `total_tu_mess` | Número absoluto de mensajes enviados |

El reporte ofrece la misma información en forma de gráfica en la parte inferior, según las fechas seleccionadas.

**Filtros particulares:**

- `Connection_LT`: tiempo en días de las conexiones mostradas;
- `Is_spend_day`: limitar a conexiones donde hubo gasto por día;
- `X TM messages`: cantidad de mensajes Travel Misleading que se considera en la segunda columna;
- `Message_type_name`: carta, mensaje normal o ambos.

**Enlace indicado:** [Travel Misleading report](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/TravelMisleadingreport/TravelMisleadingreportforpartner?:iid=4)

### 8.14 Mensajes de Travel Misleading

**Frecuencia:** una vez al día.

**Qué muestra:** los mensajes de Travel Misleading, con la agencia, el texto del mensaje, el número de veces que se envió y el número de TU que lo utilizaron.

**Filtros:**

- `Connection_LT`: periodo de tiempo de la relación con el RU;
- `TU_gender`: género de TU, por ejemplo MTU/FTU;
- `Message_type`: carta, mensaje o ambos;
- `Is_first_message`: indica si era el primer mensaje;
- `Message_trigger`: tipo de evento que disparó el mensaje, incluyendo chat request, mensaje normal o mensajes que comienzan con “creemos que...”.

**Enlace indicado:** [Mensajes de Travel Misleading](https://prod-uk-a.online.tableau.com/#/site/partnerdata/views/TravelMisleadingreport/MessagesTM?:iid=1)

## 9. Recomendación operativa de uso

La guía recomienda consultar los reportes diariamente. El flujo operativo que se desprende de la presentación es:

1. Revisar **Passport** para detectar caídas de ingresos, baja actividad o demoras de respuesta.
2. Revisar **Online sessions** para comprobar que los turnos estén activos y asociados a SourceID.
3. Revisar **Revenue detailed** para atribuir ingresos por servicio, perfil y código.
4. Revisar **Answer speed** y **Pairs with late answers** para detectar conversaciones con respuestas tardías.
5. Revisar **Pairs with not used limits** para recuperar oportunidades de conversación.
6. Revisar **TU activity**, **Scoring Board** y **Connections retention** para evaluar rendimiento agregado y por perfil.
7. Revisar **Chat ices conversion** para comparar rompehielos.
8. Revisar **Travel Misleading report** y **Mensajes de Travel Misleading** para controlar frecuencia, perfiles y tipos de mensaje.

## 10. Implicaciones para el modelo de datos de Agency OS

Esta sección contiene inferencias de diseño basadas en la guía; no es texto literal de la presentación.

### Dimensiones mínimas

El modelo debe poder identificar, como mínimo:

- agencia;
- Admin y Sub-admin;
- perfil TU;
- SourceID;
- RU;
- pareja RU–TU;
- servicio o `Revenue type`;
- tipo de crédito: `Free`/`Paid`;
- fecha y hora del evento;
- zona horaria aplicada;
- género de TU, cuando aplique;
- edad o tiempo de conexión (`Connection_LT`);
- tipo de mensaje;
- si es primer mensaje;
- disparador del mensaje;
- estado online de TU.

### Hechos o métricas principales

El sistema debe considerar hechos para:

- ingresos por servicio, agencia, TU, SourceID y tipo de crédito;
- actividad de TU por intervalo de tiempo;
- mensajes recibidos y respondidos;
- tiempo de respuesta en minutos;
- sesiones online y su asociación a SourceID;
- retención de RU y reactivación con acción pagada;
- ingresos por pareja RU–TU;
- uso de límites de conversación;
- CTR de avatar;
- conversión de rompehielos;
- uso de Travel Misleading por TU, mensaje, conexión y día.

### Granularidad temporal

La guía mezcla datos horarios, diarios y de cada tercer día. El almacén propio debe conservar la granularidad original cuando exista, sin convertir todo a una única fila diaria.

Ejemplos:

- Revenue detailed: ingreso por servicio/perfil/SourceID y rango horario.
- Online sessions: intervalos o bloques de actividad.
- Answer speed: mensajes y tiempos de respuesta.
- Connections retention: cohorte/diálogo y día de retorno.
- Travel Misleading: conexión, mensaje, tipo y día.

### Frescura y estado de extracción

Cada carga debe registrar el reporte de origen y su última actualización conocida. Un dashboard propio debe poder mostrar “actualizado hasta” y diferenciar:

- dato disponible de la última hora cerrada;
- dato del día anterior;
- dato pendiente de actualización;
- dato de un reporte que se renueva cada tercer día.

Esto es especialmente importante para no comparar métricas con ventanas de frescura distintas sin indicarlo.

### Acceso por rol

La presentación confirma que el acceso actual es compartido y no segmenta los datos por usuario. Agency OS debe tratar los datos de Tableau como información sensible y aplicar control propio por:

- rol;
- agencia;
- panel administrativo;
- coordinador;
- TU/operadora;
- SourceID;
- reporte o conjunto de métricas permitido.

## 11. Preguntas abiertas para validar antes de implementar el ETL

1. ¿Cuál es la lista exacta de vistas Tableau que se descargará diariamente?
2. ¿Cuál es el nombre técnico de cada columna exportada por Crosstab?
3. ¿`SourceID`, `Source ID`, `id_trusted user` y el ID interno de TU son identificadores diferentes o relacionados?
4. ¿Cuál es el catálogo oficial de valores de `Revenue type` y `Credits type`?
5. ¿Cuál es la jerarquía real entre Admin, Sub-admin, agencia y panel?
6. ¿Qué zona horaria contienen originalmente las marcas de tiempo de cada reporte?
7. ¿El reporte `Connections retention` realmente usa UTC-9 o la zona mostrada es una convención específica de Tableau?
8. ¿Los reportes horarios contienen filas por hora, intervalos o solo agregados?
9. ¿`time to answer (min)` se calcula desde la recepción del mensaje hasta la respuesta, y cómo se manejan respuestas múltiples?
10. ¿El umbral de menos de cinco minutos es un objetivo operativo, una métrica formal o ambas cosas?
11. ¿Cuál es la fórmula completa de `Value` y `Score` en Scoring Board?
12. ¿Qué significa exactamente la categoría “información insuficiente” en Chat ices conversion?
13. ¿Cuáles son los valores válidos de `Message_trigger` y `Message_type`?
14. ¿La guía visual de las diapositivas 34–35 contiene una categorización oficial de reportes que deba copiarse al sistema?
15. ¿Cuál es el límite de filas y el tiempo máximo de exportación de cada vista Crosstab?
16. ¿Existe histórico corregible, es decir, si Tableau recalcula un día anterior se puede detectar qué cambió?

## 12. Enlaces y soporte

### Portal principal

[Tableau SSO](https://sso.online.tableau.com/public/login)

### Aplicaciones de autenticación

- [Google Authenticator para iOS](https://apps.apple.com/es/app/google-authenticator/id388497605)
- [Google Authenticator para Android](https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2&hl=en&gl=US&pli=1)

### Soporte

La guía indica que, ante pérdida de contraseña o de acceso a Authenticator, se debe contactar al asesor de cuenta/CSM. El equipo encargado de Tableau se ubica en Europa y la restauración puede tardar hasta un día hábil.

Si los datos no se actualizan durante varias horas, se recomienda notificar al asesor o CSM. La explicación ofrecida es que Tableau procesa una base de datos grande y puede presentar retrasos, pero no debería perder información.

### Canal de Telegram

[Canal de Tableau en Telegram](https://t.me/+8T8otMXpgrljOTk6)

La presentación lo describe como el canal para noticias y actualizaciones de la herramienta.

## 13. Notas de calidad y límites de esta fuente

- La fuente es una guía visual de uso, no documentación técnica del backend de Tableau.
- Las frecuencias y definiciones deben contrastarse con exportaciones reales.
- Hay al menos un enlace con formato sospechoso (`TU activity`), uno con `http` (`Chat ices conversion`) y un enlace adicional aparentemente fuera de contexto en la diapositiva de avatar CTR.
- Las diapositivas 34 y 35 contienen el catálogo visual por categoría incluido en la sección 8.0. Los reportes adicionales del catálogo no tienen una explicación funcional completa en esta fuente y deben validarse antes de incorporarlos al alcance o al ETL.
- Los ejemplos de zonas horarias, objetivos y umbrales deben conservarse como reglas de negocio documentadas, pero no convertirse en lógica rígida hasta confirmarlos con datos de producción.
