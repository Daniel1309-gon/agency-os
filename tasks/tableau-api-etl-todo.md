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

- [x] Sustituir `TABLEAU_AUTH_TOKEN` como mecanismo principal por signin con PAT (`tableau.client.ts`, 2026-11-22).
- [ ] Separar UUID de API, content URL y URL visible.
- [x] Implementar cliente con timeout, backoff ante 429 y un solo re-signin ante 401. Concurrencia: el worker ejecuta las corridas de a una. Sin jitter (un solo proceso).
- [ ] Implementar artefacto crudo y checksum. Checksum SHA-256 por corrida hecho; falta guardar el CSV crudo (decidir almacenamiento).
- [ ] Implementar schema/mapping por vista.
- [x] Reemplazar ejecución `void` desde HTTP por worker (`tableau.worker.ts`): la API encola y el worker reclama con `FOR UPDATE SKIP LOCKED` y recupera corridas `RUNNING` de más de 30 min.
- [x] Hacer la creación de `etl_runs` atómica entre instancias (índice único vista+fecha con `ON CONFLICT DO NOTHING`).
- [x] Eliminar N+1 de resolución de perfiles (una consulta por corrida, por `external_ref`).
- [x] Implementar staging y promoción atómica (una transacción; staging con upsert por corrida+fila, migración 0026).
- [ ] Implementar puntos horarios y conciliación.
- [ ] Implementar una worksheet temporal de Revenue como fuente de detalle; Revenue detailed queda catalogada como resumen.
- [ ] Agregar métricas de frescura y alertas.
- [ ] Documentar reproceso y rollback lógico.

## Gate de entrega

- [x] Pruebas unitarias del cliente Tableau (`tableau.client.spec.ts`, `tableau-parse.spec.ts`).
- [ ] Pruebas de contrato con fixtures reales anonimizados.
- [x] Pruebas de integración PostgreSQL (`tableau.int.spec.ts`).
- [ ] Prueba de dos instancias ejecutando el mismo run.
- [x] Prueba de respuesta 429 y reintentos.
- [x] Prueba de schema drift (columna mapeada ausente → corrida `FAILED` con el nombre de la columna).
- [ ] Prueba de reproceso desde artefacto crudo.
- [ ] Revisión de seguridad sin secretos en logs ni archivos.
