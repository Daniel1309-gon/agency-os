-- OQ-08 parcial (2026-09-23): la clienta fijo al menos 30 dias de auditoria. La
-- retencion mensual ya construida conserva el mes actual y los dos anteriores:
-- piso ~59 dias y techo ~92. Con retention_months = 1 el piso real seria 28-29
-- dias por febrero, por eso se usa 2. No toca la funcion audit_log_maintain.
--
-- `value` es jsonb y el job exige jsonb_typeof = 'number' (jobs.service.ts), asi
-- que se escribe con to_jsonb y no con el literal '2'.
--
-- El seed usa onConflictDoNothing, asi que esta migracion es la que cambia las
-- bases ya existentes; el seed nuevo solo aplica a bases nuevas.
UPDATE app_settings
SET value = to_jsonb(2), updated_at = now()
WHERE key = 'audit.retention_months';
