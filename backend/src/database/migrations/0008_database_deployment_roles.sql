-- Deployment roles are group roles. Login credentials belong to concrete
-- accounts created by the deployment/bootstrap procedure, never to these
-- shared capability roles.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['agency_owner', 'agency_app', 'agency_worker', 'agency_readonly'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        role_name
      );
    ELSE
      EXECUTE format(
        'ALTER ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        role_name
      );
    END IF;
  END LOOP;

  -- The account running this migration is the only account allowed to
  -- become the owner role. Runtime accounts must never receive this grant.
  EXECUTE format('GRANT agency_owner TO %I', current_user);
END $$;
--> statement-breakpoint

-- Remove the default PUBLIC capabilities before adding explicit role grants.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT CREATE, USAGE ON SCHEMA public TO agency_owner;
--> statement-breakpoint

-- Existing application relations become owned by the non-login migration role.
-- This includes Drizzle's migration journal, so a runtime account cannot alter
-- schema history even if it can write application rows.
DO $$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT n.nspname, c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO agency_owner', relation.nspname, relation.relname);
  END LOOP;

  FOR relation IN
    SELECT n.nspname, c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO agency_owner', relation.nspname, relation.relname);
  END LOOP;

  IF to_regprocedure('public.reject_audit_log_mutation()') IS NOT NULL THEN
    ALTER FUNCTION public.reject_audit_log_mutation() OWNER TO agency_owner;
  END IF;
END $$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO agency_app, agency_worker, agency_readonly;
--> statement-breakpoint

-- HTTP runtime: application DML, but no destructive table-wide operations.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO agency_app;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM agency_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agency_app;
--> statement-breakpoint

-- Worker runtime: only the tables touched by the current maintenance and
-- outbox workers. No worker grant reaches payroll, credentials, or audit.
GRANT SELECT, UPDATE ON TABLE
  profile_sessions,
  profile_assignments,
  cafeteria_orders,
  shifts,
  breaks,
  scheduled_messages,
  users,
  rocketchat_channels
TO agency_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE outbox_events TO agency_worker;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM agency_worker;
DO $$
DECLARE
  sequence_name text;
BEGIN
  sequence_name := pg_get_serial_sequence('public.outbox_events', 'id');
  IF sequence_name IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO agency_worker', sequence_name);
  END IF;
END $$;
--> statement-breakpoint

-- Future tables created by the migration owner receive the same safe HTTP
-- default. Worker and readonly access stays explicit and reviewable.
ALTER DEFAULT PRIVILEGES FOR ROLE agency_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE agency_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO agency_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agency_owner IN SCHEMA public REVOKE DELETE, TRUNCATE ON TABLES FROM agency_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agency_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agency_app;
ALTER DEFAULT PRIVILEGES FOR ROLE agency_owner IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint

-- Readonly support/reporting allowlist. Sensitive tables are omitted or
-- exposed only through non-secret columns; no wildcard grant is used here.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'roles', 'permissions', 'role_permissions', 'crews', 'crew_members',
    'operator_compensation', 'ip_allowlist', 'login_attempts', 'audit_log',
    'tt_profiles', 'credential_access_log', 'shift_templates', 'shifts',
    'shift_overrides', 'profile_assignments', 'profile_sessions', 'breaks',
    'operator_status_events', 'operator_current_status', 'metric_events',
    'profile_daily_metrics', 'metric_reconciliation', 'tableau_views',
    'tableau_hourly_points', 'etl_runs', 'etl_staging_rows', 'icebreaker_rules',
    'icebreakers', 'icebreaker_evaluations', 'icebreaker_violations',
    'icebreaker_reviews', 'icebreaker_effectiveness', 'payroll_periods',
    'points_ledger', 'payroll_lines', 'payroll_adjustments', 'goals',
    'competitions', 'competition_participants', 'payroll_exports',
    'cafeteria_products', 'cafeteria_orders', 'cafeteria_order_items',
    'operator_account_entries', 'rocketchat_channels', 'scheduled_messages',
    'notifications', 'interaction_campaigns', 'interaction_events', 'feature_flags'
  ] LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO agency_readonly', table_name);
  END LOOP;
END $$;
--> statement-breakpoint

GRANT SELECT (
  id, email, full_name, role_id, status, must_change_password,
  password_changed_at, last_login_at, failed_login_count, locked_until,
  rocketchat_user_id, rocketchat_direct_room_id, version, created_at,
  updated_at, created_by, updated_by, deleted_at
) ON TABLE users TO agency_readonly;
--> statement-breakpoint

GRANT SELECT (
  id, hostname, label, assigned_operator_id, status, token_issued_at,
  token_expires_at, extension_version, helper_version, os_version, last_seen_at,
  last_ip, created_at, approved_by, revoked_at, revoked_reason
) ON TABLE devices TO agency_readonly;
--> statement-breakpoint

GRANT SELECT (
  id, profile_id, username, version, is_current, rotated_at, rotated_by, created_at
) ON TABLE tt_profile_credentials TO agency_readonly;
--> statement-breakpoint

-- Make the column-level grants above the only readonly access to these
-- sensitive relations.
REVOKE ALL ON TABLE users, devices, tt_profile_credentials FROM agency_readonly;
GRANT SELECT (
  id, email, full_name, role_id, status, must_change_password,
  password_changed_at, last_login_at, failed_login_count, locked_until,
  rocketchat_user_id, rocketchat_direct_room_id, version, created_at,
  updated_at, created_by, updated_by, deleted_at
) ON TABLE users TO agency_readonly;
GRANT SELECT (
  id, hostname, label, assigned_operator_id, status, token_issued_at,
  token_expires_at, extension_version, helper_version, os_version, last_seen_at,
  last_ip, created_at, approved_by, revoked_at, revoked_reason
) ON TABLE devices TO agency_readonly;
GRANT SELECT (
  id, profile_id, username, version, is_current, rotated_at, rotated_by, created_at
) ON TABLE tt_profile_credentials TO agency_readonly;
