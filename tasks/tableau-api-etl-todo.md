# Checklist de análisis Tableau y ETL

## Antes de la prueba en vivo

- [ ] Confirmar que el PAT se proporciona por un canal seguro y que no fue expuesto.
- [x] Configurar `TABLEAU_API_BASE_URL`, `TABLEAU_API_VERSION`, `TABLEAU_SITE_CONTENT_URL`, `TABLEAU_PAT_NAME` y `TABLEAU_PAT_SECRET` solo en el entorno local/secret manager.
- [x] Confirmar que el PAT tiene permiso de lectura sobre el sitio y workbooks.
- [x] Confirmar la ventana autorizada para consultas de discovery.

> El PAT es permanente y pertenece a la cuenta administrativa de la cliente. Antes de producción
> debe migrarse a secret manager, quedar con nombre dedicado/allowlist, alerta de uso y procedimiento
> de revocación; no se marca como terminado mientras siga en `.env` local.

## Discovery

- [x] Ejecutar signin y registrar únicamente metadata redacted.
- [x] Enumerar workbooks con paginación.
- [x] Enumerar vistas por workbook.
- [x] Enumerar vistas a nivel de sitio y deduplicar por LUID.
- [x] Cruzar vistas reales con el catálogo de la guía Tableau.
- [ ] Identificar la vista de puntos horarios.
- [x] Descargar muestra CSV de Revenue detailed.
- [x] Descargar crosstab de Revenue detailed y de `Revenue detailed (SourceID)`; ambos son resumen,
  no sustituyen una worksheet horaria plana.
- [ ] Obtener/publicar una worksheet plana con una fila por perfil/SourceID/hora.
- [ ] **Solicitar a la clienta** esa worksheet plana, incluyendo columnas, nulos esperados y zona
  horaria declarada.
- [x] Registrar columnas, filas, bytes, latencia y checksum de Revenue detailed.
- [x] Probar la vista hermana `Revenue detailed (SourceID)`: 1.539 filas, nueve fechas semanales,
  `Max Hour=20` constante; no cumple el contrato horario.
- [x] Probar filtros exactos por valores observados, candidatos de la guía y campo inválido.
- [x] Confirmar por documentación que REST `vf_` no soporta rangos; no usarlo como estrategia de ventana.
- [ ] Verificar timezone y corte de día.
- [ ] Medir respuesta a repetición, `maxAge` y errores 401/403/404/429.

## Diseño e implementación

- [ ] Sustituir `TABLEAU_AUTH_TOKEN` como mecanismo principal por signin con PAT.
- [ ] Separar UUID de API, content URL y URL visible.
- [ ] Implementar cliente con timeout, backoff, jitter y límite de concurrencia.
- [ ] Implementar artefacto crudo y checksum.
- [ ] Implementar schema/mapping por vista.
- [ ] Reemplazar ejecución `void` desde HTTP por worker/job durable.
- [ ] Hacer la creación de `etl_runs` atómica entre instancias.
- [ ] Eliminar N+1 de resolución de perfiles.
- [ ] Implementar staging y promoción atómica.
- [ ] Implementar puntos horarios y conciliación.
- [ ] Implementar una worksheet temporal de Revenue como fuente de detalle; Revenue detailed queda catalogada como resumen.
- [ ] Agregar métricas de frescura y alertas.
- [ ] Documentar reproceso y rollback lógico.

## Gate de entrega

- [ ] Pruebas unitarias del cliente Tableau.
- [ ] Pruebas de contrato con fixtures reales anonimizados.
- [ ] Pruebas de integración PostgreSQL/Redis.
- [ ] Prueba de dos instancias ejecutando el mismo run.
- [ ] Prueba de respuesta 429 y reintentos.
- [ ] Prueba de schema drift.
- [ ] Prueba de reproceso desde artefacto crudo.
- [ ] Revisión de seguridad sin secretos en logs ni archivos.
