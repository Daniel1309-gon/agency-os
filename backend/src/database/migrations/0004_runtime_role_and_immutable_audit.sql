-- Runtime database role: deployment grants LOGIN only to a concrete account
-- that inherits this role. The migration owner remains reserved for migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agency_app') THEN
    CREATE ROLE agency_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO agency_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agency_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agency_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agency_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agency_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM agency_app;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_reject_row_mutation ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_reject_row_mutation
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_reject_truncate ON audit_log;
--> statement-breakpoint
CREATE TRIGGER audit_log_reject_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint

-- Vault redemption updates only the append-created row belonging to the
-- authenticated actor. Without this policy the application role cannot mark a
-- grant as consumed while RLS is active.
DROP POLICY IF EXISTS "credential_access_update_own" ON "credential_access_log";
--> statement-breakpoint
CREATE POLICY "credential_access_update_own" ON "credential_access_log"
  FOR UPDATE USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'JOB')
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ) WITH CHECK (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'JOB')
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
