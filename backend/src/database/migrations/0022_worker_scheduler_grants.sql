-- El worker dedicado ejecuta el scheduler (materializacion de turnos, cierre,
-- reaper, avisos, particiones de auditoria y jobs durables). Estos son los
-- unicos privilegios que faltaban frente a los grants de 0008 y 0017; no toca
-- nomina, credenciales ni escritura de auditoria.
GRANT SELECT ON TABLE
  app_settings,
  shift_templates,
  shift_overrides,
  roles,
  crew_members
TO agency_worker;
--> statement-breakpoint
GRANT INSERT ON TABLE shifts TO agency_worker;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION audit_log_maintain(int, int) TO agency_worker;
