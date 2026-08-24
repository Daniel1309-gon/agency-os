# ADR 0008: Binding server-side del perfil de Chrome

- Estado: aceptada
- Fecha: 2026-08-24
- Alcance: FR-12, OPS-03, SEC-09

## Contexto

El navegador recibe `chromeProfileDir` desde la web para lanzar el perfil nativo de Chrome. Si el
backend aceptara ese valor sin compararlo con la configuración del perfil TalkyTimes, un operador
podría iniciar la cuenta en otra carpeta y romper el aislamiento de cookies. La sesión además nace
sin estación cuando la web la prepara y solo obtiene `device_id` cuando una estación aprobada pide
el grant del vault.

## Decisión

`tt_profiles.chrome_profile_dir` es la fuente de verdad para el nombre lógico de la carpeta Chrome.
El valor solo puede tener el formato `Default` o `Profile N` (`N` de uno a tres dígitos). Antes de
crear una sesión, el backend comprueba primero la asignación del operador y después exige que el
binding exista y coincida exactamente con el `chromeProfileDir` recibido. El mismo formato se
valida en los contratos compartidos y en el CRUD de perfiles.

El vault vuelve a comprobar que la sesión `LAUNCHING` y el perfil activo conservan el mismo binding
antes de emitir un grant. La reclamación de una sesión preparada incluye la misma condición en el
`UPDATE` atómico: solo una estación aprobada puede fijar `device_id`, y no puede hacerlo si la
configuración cambió. Mientras una sesión esté viva (`LAUNCHING`, `ACTIVE`, `ERROR` o `STALE`) no
se permite cambiar el binding del perfil.

El nombre es lógico y debe estar presente de forma consistente en las estaciones administradas; la
prueba física de cookies aisladas entre hasta ocho perfiles sigue siendo un gate E2E de la PC real.

## Alternativas consideradas

### Confiar en el valor enviado por la web

Rechazado: la web es un cliente y no puede ser la autoridad de aislamiento.

### Aprender el binding desde la primera estación

Rechazado: permitiría que el primer cliente que llegue fijara una configuración no aprobada y no
ofrece un lifecycle administrativo para corregirla.

### Tabla independiente por dispositivo en este slice

Aplazado: requiere un flujo explícito de alta, revisión y rotación de mapas por estación. El
servidor ya liga la sesión reclamada al `device_id`; la variación física por PC y la evidencia de
cookies quedan en el gate de despliegue administrado de FR-12.

## Consecuencias

- Un perfil sin carpeta configurada no puede abrir sesiones: falla cerrado con 409.
- Un valor alterado en la sesión no puede obtener credenciales del vault.
- Cambiar la carpeta requiere cerrar primero las sesiones vivas, evitando invalidarlas a mitad del
  lanzamiento.
- El backend no afirma todavía que Chrome haya aplicado la carpeta correcta físicamente; eso se
  valida en la PC de prueba con la extensión y el helper reales.
