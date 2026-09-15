# Evidencia de cierre funcional — Chrome automatizado

Fecha: 2026-09-10
Alcance: CA-00a a CA-05 del plan de cierre de Chrome automatizado.

## Resultado

El recorrido de software quedó implementado: Perfiles configura la credencial en el vault, el
backend valida alcance y versión, el agente reclama la sesión de estación y abre un Chrome
aislado con un directorio nuevo por sesión. El agente renueva autorización, enfoca sesiones
vivas y confirma cierres de forma idempotente. Los secretos no se devuelven en respuestas ni se
escriben en auditoría.

CA-00a y CA-01 quedan verificadas con código, contratos y pruebas automatizadas. CA-00b y CA-05
tienen la implementación y el puente web verificados; falta una prueba renderizada del formulario
y del flujo completo. CA-02, CA-03 y CA-04 tienen implementación y pruebas parciales; la
aceptación final requiere una PC Windows de prueba y un navegador real. CA-06 permanece abierta.

## Cambios comprobables

- Permisos separados: `vault.rotate` para credenciales y `vault.keys.rotate` para la clave maestra.
  La migración actualiza instalaciones existentes y las políticas RLS aplican el alcance del
  perfil; el endpoint de metadatos usa el mismo alcance.
- El formulario de Perfiles permite configurar o actualizar usuario y contraseña, limpia el
  secreto del estado al terminar y muestra únicamente metadatos de configuración.
- `POST /station/sessions/:id/heartbeat` devuelve decisión, versión, hora del servidor y fin
  efectivo. `POST /station/sessions/:id/close` confirma el cierre sin sobrescribir el cierre de
  negocio.
- Cada apertura usa `slot-Profile_X/<sessionId>`, desactiva el guardado de contraseñas y protege
  el campo de contraseña contra el control rutinario de revelado.
- El agente usa un ciclo de heartbeat independiente por sesión, límites de petición y errores
  sanitizados. La apertura de otra sesión no mantiene un lock durante el login.

## Verificaciones ejecutadas

- Shared: build y lint correctos.
- Backend: typecheck, lint, build y `db:check` correctos.
- Backend completo: 34 suites unitarias, 194 pruebas y 7 reglas de arquitectura correctas.
- Contratos/OpenAPI: 9 pruebas correctas.
- Permisos/vault: 23 pruebas unitarias correctas; integración de vault 20/20.
- Asignaciones, heartbeat y cierre: 37/37 pruebas de integración correctas.
- RLS: 17/17 pruebas de integración correctas.
- Web: typecheck, build y 39/39 pruebas correctas.
- Agente: `uv run tools/agency-os-local-agent.py --self-test` correcto.
- Salud local: backend `/health/ready` y agente `/health` correctos.
- Frontend dev: responde HTTP 200 en `127.0.0.1:5173`.
- Trazabilidad: `pnpm test:requirements` 34/34 y 44 requisitos verificados.
- Verificación API: `/profiles` devuelve metadatos de credencial sin devolver secretos.

No se conservaron contraseñas, tokens de acceso ni valores de credenciales en esta evidencia.

## Límites pendientes

- Falta probar Windows Job Objects, crash/reinicio, suspensión/reanudación, árbol de procesos y
  que Chrome personal no sea afectado.
- Falta ejecutar el ciclo A → B → A con cookie, localStorage, IndexedDB y service worker en una
  PC de prueba.
- Falta verificar en TalkyTimes el ojo de contraseña, el guardado deshabilitado y el login real
  con credenciales autorizadas en la versión final del agente.
- Falta medir 1, 2, 5 y 8 perfiles y observar tres días operativos con relevo, revocación y red
  caída.
- El fallback de la extensión y su distribución se conservan hasta cerrar CA-06; no se debe
  retirar todavía.
