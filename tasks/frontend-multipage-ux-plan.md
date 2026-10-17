# Plan de corrección UX: navegación por páginas dedicadas

## Resumen

- Reemplazar el dashboard monolítico y sus anclas `#section-*` por rutas reales dentro de la SPA.
- Mostrar una sola tarea principal por página y cargar únicamente sus datos.
- Mantener la identidad visual actual; el cambio será de arquitectura de información, no un rediseño.
- No crear una página "Inicio": después del login se abrirá directamente la primera ruta útil del rol.

## Estado actual que debe corregirse

- `AppShell` construye el navbar con enlaces `#section-*` y marca siempre el primer enlace como activo.
- `DashboardPage` monta simultáneamente todos los módulos autorizados del rol, lo que produce una sola vista extensa y dispara consultas y sockets de áreas que el usuario no está viendo.
- En pantallas de hasta 820 px el sidebar desaparece y la barra móvil no ofrece navegación entre secciones.
- Algunos bloques repiten la misma información, especialmente la vista de métricas de dirección y administración.
- Cafetería anuncia Ventas e Inventario, pero esos módulos todavía no tienen interfaz funcional.

## Rutas y contenido

| Rol | Navegación, en orden |
|---|---|
| Operador | `/app/perfiles` Mis perfiles · `/app/turno` Mi turno · `/app/cafeteria` Cafetería |
| Coordinador | `/app/equipo` Equipo · `/app/usuarios` Usuarios · `/app/perfiles` Perfiles · `/app/asignaciones` Asignaciones · `/app/turnos` Turnos · `/app/auditoria` Auditoría |
| Cafetería | `/app/pedidos` Pedidos/KDS · `/app/menu` Menú · `/app/ventas` Ventas · `/app/inventario` Inventario |
| Director Operativo | `/app/metricas` Métricas · `/app/usuarios` Usuarios · `/app/perfiles` Perfiles · `/app/asignaciones` Asignaciones · `/app/turnos` Turnos · `/app/auditoria` Auditoría |
| Administrador | `/app/metricas` Métricas · `/app/usuarios` Usuarios · `/app/perfiles` Perfiles · `/app/asignaciones` Asignaciones · `/app/turnos` Turnos · `/app/seguridad` Seguridad · `/app/acceso-ip` Acceso por IP · `/app/auditoria` Auditoría |

- Ventas e Inventario tendrán páginas breves de funcionalidad pendiente, sin datos ficticios, formularios deshabilitados ni llamadas al backend.
- Las rutas se filtrarán por los permisos efectivos del usuario, no solo por su rol.
- Una ruta desconocida o no autorizada redirigirá mediante `replaceState` a la primera página permitida.
- La URL solicitada antes del login se conservará si el usuario tiene acceso; cerrar sesión devolverá a `/`.
- La configuración de Nginx ya usa `try_files $uri $uri/ /index.html`, por lo que las rutas directas y la recarga no requieren cambios de infraestructura.

### Ruta inicial por rol

- Operador: `/app/perfiles`.
- Coordinador: `/app/equipo`.
- Cafetería: `/app/pedidos`.
- Director Operativo y Administrador: `/app/metricas`.

## Cambios de implementación

### 1. Registro único de páginas y navegación

- Crear un registro tipado con `id`, ruta, etiqueta, grupo, encabezado, permiso requerido, roles, estado pendiente y marca de página extensa.
- Usar ese mismo registro para resolver la ruta, construir el navbar y determinar la página inicial. No mantener listas separadas que puedan divergir.
- Añadir los tipos internos `WorkspacePageId` y `WorkspaceRoute`; no cambiar DTO, endpoints ni contratos de autenticación.
- Usar la History API nativa (`pushState` y `popstate`) porque las rutas son estáticas y no hay parámetros anidados. No añadir React Router.

### 2. Shell y navegación responsive

- Sustituir las anclas internas por enlaces con `href` real y `aria-current="page"`.
- Retirar los marcadores numéricos: ya no representan una secuencia y agregan ruido visual.
- Agrupar las opciones largas bajo "Operación" y "Control" en escritorio.
- Mantener el sidebar en escritorio y añadir un `<select>` nativo con las mismas rutas en la barra móvil.
- Actualizar el breadcrumb para mostrar `Agency OS / Página actual`.
- Al navegar, desplazar al inicio y mover el foco al `h1` de la nueva página mediante `tabIndex={-1}`.
- Interceptar solo clics primarios sin modificadores; conservar el comportamiento normal de abrir enlaces en otra pestaña.

### 3. Composición por tarea y reducción de densidad

- Renderizar exclusivamente el componente de la ruta activa. Al cambiar de página, desmontar el módulo anterior para cerrar sus efectos y sockets.
- Reemplazar los agregadores monolíticos de operaciones y seguridad por composición directa de los componentes existentes; eliminar los wrappers cuando queden sin consumidores.
- Cada ruta tendrá un solo `h1`, una descripción de una frase y una única tarea principal.
- Separar explícitamente Perfiles de Asignaciones, y Seguridad de Acceso por IP y Auditoría.
- Dividir Cafetería en Menú y Pedidos/KDS; el panel de pedidos del operador permanecerá en su propia ruta `/app/cafeteria`.
- Simplificar Métricas: conservar las cuatro métricas principales y retirar los bloques que repiten esos mismos valores sin aportar otra decisión.
- Conservar los estados reales de carga, error y vacío de cada módulo. Las páginas pendientes solo explicarán en una frase que la función aún no está disponible y dirigirán a Pedidos o Menú.
- No añadir caché global ni un store de navegación: cada componente seguirá administrando su estado local y cargará al montarse.

### 4. Movimiento con moderación

- Añadir `tailwind-animations` 1.x, paquete sin scope, e importarlo después de `@import "tailwindcss"` en el CSS global.
- Aplicar animaciones de entrada ligadas al scroll únicamente a los bloques principales de páginas extensas: Perfiles administrativos, Asignaciones, Turnos, Seguridad, Acceso por IP y Auditoría.
- Usar una entrada discreta `fade-in-up` con recorrido corto y rango de entrada; no animar filas, tablas completas ni cada tarjeta.
- Aplicar las utilidades bajo `motion-safe` y conservar la regla global existente de `prefers-reduced-motion`.
- El contenido debe seguir visible y utilizable si el navegador no soporta scroll timelines.
- Referencias: [tailwind-animations para Tailwind 4](https://github.com/midudev/tailwind-animations) y [reduced motion de Tailwind](https://tailwindcss.com/docs/hover-focus-and-other-states#prefers-reduced-motion).

## Orden de implementación

1. Crear el registro de páginas y sus pruebas de resolución.
2. Incorporar el estado de ubicación y la navegación History API en la aplicación autenticada.
3. Adaptar el shell para enlaces activos, grupos, breadcrumb y selector móvil.
4. Reemplazar el render monolítico por el componente de la ruta activa y retirar agregadores obsoletos.
5. Separar Menú de KDS, crear las dos páginas pendientes y simplificar Métricas.
6. Integrar `tailwind-animations` solo en las páginas extensas.
7. Ejecutar pruebas automatizadas y verificación completa en navegador.

## Pruebas y criterios de aceptación

### Automatizadas

- Probar el orden y la ruta inicial de los cinco roles.
- Probar que los permisos efectivos ocultan rutas y bloquean acceso directo.
- Probar la redirección de rutas desconocidas o no autorizadas.
- Probar que Ventas e Inventario son las únicas rutas marcadas como pendientes.
- Probar que el navbar y el renderizador consumen el mismo registro.
- Ejecutar:
  - `pnpm --dir web-app test`
  - `pnpm --dir web-app typecheck`
  - `pnpm --dir web-app lint`
  - `pnpm --dir web-app build`

### Navegador

- Verificar enlaces, recarga directa, atrás/adelante, login y logout.
- Recorrer la navegación completa con los cinco roles.
- Confirmar que solo existe una página funcional montada y un enlace con `aria-current="page"`.
- Confirmar que cambiar de página no deja WebSockets ni consultas de módulos inactivos.
- Verificar navegación por teclado, foco visible, orden lógico y jerarquía `h1` → `h2` → `h3`.
- Comprobar 320, 768, 1024 y 1440 px; en móvil todas las páginas deben ser accesibles desde el selector.
- Probar animaciones normales y con `prefers-reduced-motion`.
- Terminar con consola sin errores ni advertencias de accesibilidad.

## Supuestos fijados

- La separación será por tarea, aunque el navbar actual agrupe varias tareas en una etiqueta.
- Pedidos/KDS será la entrada predeterminada del rol Cafetería.
- Ventas e Inventario permanecerán visibles como páginas pendientes hasta su entrega funcional.
- Se preservarán la paleta, tipografía, espaciado y lenguaje visual existentes.
- No se añadirá un router externo, una portada adicional, datos simulados ni animaciones JavaScript.
