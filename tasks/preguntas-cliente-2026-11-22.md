# Decisiones pendientes para cerrar el alcance de Agency OS

Fecha: 2026-11-22. Destinataria: dueña de la agencia (clienta 2).

Estas decisiones bloquean partes concretas del trabajo que queda. Cada punto indica qué
bloquea y la opción que recomendamos, para que pueda responder rápido. Las preguntas están
agrupadas por tema; no hace falta responderlas todas a la vez, pero las del bloque 1 son las que
más trabajo destraban.

---

## 1. Tableau: datos de puntos por hora (bloquea la nómina por turnos, FR-19 y FR-28 a FR-31)

Revisamos la documentación oficial de Tableau Cloud y probamos su API contra el sitio de la
agencia. La conclusión es que **los puntos por hora no se pueden obtener de las vistas actuales**:

- La API de Tableau entrega el mismo resumen que ve en pantalla. El detalle que aparece al expandir
  `ID Trusted User` en la interfaz no está disponible por API.
- "Revenue detailed" no trae fecha ni hora, y "Revenue detailed (SourceID)" es semanal.
- El servicio de consultas de Tableau (VizQL Data Service) no agrupa por hora ni por minuto, solo
  por fecha. Tampoco resuelve el problema.

Para repartir los puntos entre los turnos de 06:05, 14:05 y 22:05 necesitamos lo siguiente:

1. **¿Puede publicar en Tableau una hoja (worksheet) plana con una fila por perfil, SourceID y
   hora?** Las columnas mínimas serían: identificador del perfil (el mismo `ID Trusted User` o
   SourceID), fecha y hora de inicio de la hora, y puntos de esa hora. Sin filas de total. Si ya
   existe una hoja así, nos basta con su nombre.
2. **¿En qué zona horaria están las fechas y horas de Tableau?** ¿Hora de Colombia, UTC u otra?
   Si hay un desfase de una hora, los puntos se asignan mal justo en cada cambio de turno, aunque
   el total del día cuadre.
3. **¿La fuente de datos de "Revenue detailed" está publicada en Tableau, o va incrustada en el
   libro? ¿Tiene algún campo con la hora?** Si está publicada y tiene la hora, podríamos leerla
   sin que usted cree una hoja nueva.
4. **Usuario dedicado para la integración.** Recomendamos crear en Tableau un usuario solo para
   Agency OS, con rol **Viewer** o **Explorer** y permiso de ver y descargar datos resumidos de
   esas vistas, y generar con él un token de acceso personal (PAT). Hoy la integración usa el PAT
   de la cuenta administrativa. Dos motivos para cambiarlo:
   - Si alguien inicia sesión con ese mismo PAT en otro lugar, por ejemplo en Postman, la sesión
     del sistema se corta.
   - El PAT caduca si pasa 15 días sin usarse.
5. **¿A qué hora se actualizan los datos del libro en Tableau?** El proceso automático está
   previsto para las 09:15 (hora de Colombia), con los datos del día operativo anterior. Si Tableau
   se actualiza más tarde, movemos esa hora.

## 2. Nómina (bloquea FR-28 a FR-31; pregunta abierta OQ-09)

1. **Fórmulas de nómina, metas, bonos y eventos dinámicos.** Necesitamos las reglas exactas:
   - cómo se calculan los bonos;
   - si las metas son mensuales o por periodo;
   - cómo se cuentan los días trabajados;
   - qué tipos de "eventos dinámicos" puede crear el administrador.
2. **Qué ve el operador (FR-28).** El requisito dice: "El operador ve sus puntos del mes y el
   equivalente en COP según su porcentaje de comisión asignado. No ve el total de puntos brutos ni
   el 100% si tiene un techo menor." Lo implementamos así: el operador ve **sus puntos ya
   multiplicados por su comisión** y **el valor en COP neto**. No ve los puntos brutos, el COP
   bruto, la tasa ni el porcentaje. Ejemplo: con 100 puntos y una comisión del 35%, ve 35 puntos.
   **¿Es correcto, o debe ver los 100 puntos y solo el COP neto?**
3. **Operador sin comisión configurada.** Antes, si a un operador no se le había configurado la
   comisión, el sistema le pagaba el 100%. Ahora el cálculo de nómina se detiene y muestra qué
   operadores falta configurar. **¿Está de acuerdo?** Recomendamos que sí: así se evita pagar de
   más sin que nadie lo note.
4. **Cambio de comisión a mitad de mes.** Hoy se aplica a todo el periodo la comisión que estaba
   vigente el último día del periodo. **¿Debe prorratearse por días cuando cambia a mitad de mes?**
5. **Tasa por defecto del periodo.** Cada operador tiene su propia tasa de conversión de puntos a
   COP. **¿Se necesita además una tasa general por periodo para quienes no tienen una individual?**
   Si no hace falta, la retiramos para simplificar.

6. **Consumo de cafetería mayor que lo ganado.** El consumo del periodo se descuenta de la
   nómina. Si un operador consume más de lo que gana en el periodo, el total a pagar queda
   negativo. **¿Ese saldo pasa al periodo siguiente, se cobra aparte o hay un tope de consumo?**
   Mientras tanto, el sistema muestra el total negativo tal cual, sin arrastrarlo.

## 3. Icebreakers con IA (bloquea FR-22 a FR-27)

1. **Reglas de TalkyTimes.** Necesitamos la lista documentada de las normas vigentes de TalkyTimes
   para icebreakers: qué está prohibido y qué solo merece una advertencia. Sin esa lista el módulo
   funciona, pero no se puede poner en operación.
2. **¿El puntaje tiene un mínimo que bloquee la publicación?** Por ejemplo, que un icebreaker con
   menos de 40/100 no pueda publicarse aunque cumpla las normas.
3. **Flujo de aprobación.** ¿Un icebreaker que pasa la validación se publica de inmediato, o
   necesita además la aprobación de un coordinador? ¿Quién decide los falsos positivos: el
   coordinador, el director operativo o ambos?

Aclaración: ya corregimos el validador para que **las normas siempre se apliquen**. La IA puede
bloquear un texto adicional, pero nunca aprobar uno que incumple una norma. Cada bloqueo queda
registrado con la norma incumplida.

## 4. Infraestructura y alcance de la Entrega 1 (bloquea el acta de E1 y la segunda cuota)

1. **Aceptación por escrito de la topología de producción.** El contrato prevé dos instancias del
   backend con PostgreSQL y Redis en alta disponibilidad. Lo acordado en el ensayo es arrancar en
   **un solo servidor** con copias de seguridad externas cada 30 minutos, y pasar a alta
   disponibilidad más adelante. El sistema quedó preparado para ese paso. **¿Confirma por escrito
   este cambio, sabiendo que el punto de recuperación pasa de 5 a 30 minutos?**
2. **Puntos que pasan de E1 a E2.** Confirmar por escrito que el refresco en tiempo real del panel
   de perfiles (OPS-04) y el recifrado de credenciales a la clave vigente (SEC-09b) pasan a la
   Entrega 2.
3. **Servidor y cuenta de copias.** Necesitamos acceso al VPS de producción de la agencia y a la
   cuenta de Backblaze B2 para el despliegue definitivo.
4. **PC de prueba de la oficina.** Para la prueba de la extensión con perfiles reales (INT-01)
   necesitamos una PC de la oficina y credenciales de perfiles autorizadas para probar.

## 5. TalkyTimes y alcance pendiente

1. **Autorización del spike de TalkyTimes (OQ-11).** Para la Feature #9 y FR-39 hay que probar
   cuánto se puede leer de una conversación en TalkyTimes. ¿Autoriza la prueba, y con qué perfiles?
2. **Máximo de perfiles por operador (OQ-13).** ¿Cuántos perfiles puede tener abiertos a la vez un
   mismo operador? Influye en el hardware de las PCs: estimamos 16 GB de RAM para 5 perfiles.
3. **Alcance de tres módulos mencionados en las notas del requerimiento.** ¿Entran en esta versión?
   - **Competencias** entre operadores por puntos: ya existe una tabla de posiciones básica.
   - **Traductor**: no está construido.
   - **Horas extra**: el registro existe, falta el cálculo en nómina.

---

Con las respuestas del bloque 1 (Tableau) y del bloque 2 (nómina) podemos terminar la integración
de puntos por hora y la nómina completa. Con el bloque 4 podemos cerrar formalmente la Entrega 1.
