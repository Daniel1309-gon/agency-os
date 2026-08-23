# ADR 0003: IP allowlist and trusted proxy boundary

- Estado: aceptada
- Fecha: 2026-08-22
- Alcance: SEC-03

## Contexto

La restricción por IP protege también las rutas públicas de autenticación,
refresh, enrollment y el webhook de Rocket.Chat. Si `@Public()` implicara
omitir la allowlist, esas rutas quedarían expuestas aunque no requieran JWT.
Además, `X-Forwarded-For` solo es confiable cuando la conexión inmediata
proviene de un balanceador conocido.

## Decisión

Fastify recibe `trustProxy` únicamente como la lista de CIDR configurada en
`TRUSTED_PROXY_CIDRS`. Cada entrada se valida al arrancar; producción no inicia
si la lista está vacía o contiene una entrada inválida. El resolvedor común de
HTTP y WebSocket valida la cadena de proxies desde el socket hacia afuera,
normaliza IPv4-mapped IPv6 (incluidas formas hexadecimales) y nunca toma
directamente `X-Forwarded-For` como identidad.

La allowlist se aplica antes de JWT en todas las rutas. `@Public()` solo omite
autenticación. La única excepción de IP son los métodos `GET /health/live` y
`GET /health/ready`, que usan `@SkipIpAllowlist()` de forma explícita. El
bootstrap inicial de la allowlist ocurre mediante `db:bootstrap-ip`, fuera de
un endpoint público. Los DTO administrativos rechazan CIDR inválidos antes de
escribir en PostgreSQL.

Los CIDR se canonicalizan y se rechazan si contienen bits de host, antes de
persistirlos o entregarlos a Fastify. Las denegaciones de perímetro HTTP y
WebSocket se auditan con metadata allowlisted y ruta sin query string. Se
limita una auditoría por combinación de acción, IP y ruta durante una ventana
de un minuto para evitar que un escaneo convierta el propio audit log en un
amplificador de carga; los fallos JWT/rol/permiso conservan su auditoría por
solicitud.

## Alternativas rechazadas

- Confiar en todos los proxies o usar `trustProxy: true`: permite falsificar la
  IP mediante cabeceras reenviadas.
- Hacer que `@Public()` omita también la IP: abriría login, refresh, enrollment
  y el webhook a Internet.
- Leer `X-Forwarded-For` directamente desde el guard: duplicaría la lógica de
  Fastify y permitiría saltarse la cadena de proxies confiables.
- Permitir CIDR arbitrario y dejar que el error lo produzca PostgreSQL: genera
  respuestas 500 y desplaza una validación de entrada a una capa de persistencia.

## Consecuencias

- Cada despliegue detrás de proxy debe declarar sus rangos reales en
  `TRUSTED_PROXY_CIDRS` y ejecutar el bootstrap inicial antes de recibir tráfico.
- Un cambio de topología de balanceador requiere actualizar configuración y
  pruebas de IP forwarded; no se puede resolver agregando una excepción pública.
- La limitación de auditoría es local a cada instancia del proceso. El registro
  de denegaciones sigue siendo durable, pero un despliegue multi-instancia puede
  producir hasta una auditoría por instancia y ventana.
