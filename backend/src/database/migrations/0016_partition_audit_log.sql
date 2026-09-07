-- audit_log pasa a estar particionada por mes, como pide PLAN.md §3.1, y gana una
-- función de mantenimiento que crea particiones por adelantado y aplica la retención.
--
-- Dos cosas que la conversión no puede perder:
--
--   1. La clave de partición tiene que estar en la PK, así que la PK pasa de (id) a
--      (id, occurred_at). El id sigue siendo identity y sigue sin exponerse como
--      identidad externa.
--
--   2. Los triggers de fila se clonan solos a cada partición, pero los de TRUNCATE NO.
--      Sin un trigger propio por partición, `TRUNCATE audit_log_2026_09` borraría un mes
--      entero de auditoría saltándose la inmutabilidad que 0004 garantiza hoy. Por eso el
--      trigger de TRUNCATE se crea dentro de audit_log_ensure_partition, y no solo sobre
--      el padre. Verificado contra PostgreSQL 16 antes de escribir esta migración.

ALTER TABLE "audit_log" RENAME TO "audit_log_legacy";
--> statement-breakpoint
-- El nombre del índice de una PK es global al esquema: hay que liberarlo antes de que la
-- tabla nueva reclame el suyo.
ALTER TABLE "audit_log_legacy" RENAME CONSTRAINT "audit_log_pkey" TO "audit_log_legacy_pkey";
--> statement-breakpoint
ALTER INDEX "audit_log_occurred_at_idx" RENAME TO "audit_log_legacy_occurred_at_idx";
--> statement-breakpoint
ALTER SEQUENCE "audit_log_id_seq" RENAME TO "audit_log_legacy_id_seq";
--> statement-breakpoint

CREATE TABLE "audit_log" (
	"id" bigint GENERATED ALWAYS AS IDENTITY,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_user_id" uuid,
	"actor_device_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"result" varchar(16) NOT NULL,
	"ip" "inet",
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id", "occurred_at"),
	CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "audit_log_actor_device_id_devices_id_fk" FOREIGN KEY ("actor_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "audit_log_no_secret_keys" CHECK (NOT jsonb_exists_any("metadata", ARRAY[
		'password','contrasena','contraseña','secret','plaintext',
		'credential','credentialValue','secret_ciphertext','token'
	]))
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint

CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");
--> statement-breakpoint

-- Crea la partición de un mes si falta, con su trigger de TRUNCATE y sin ningún grant
-- directo: la aplicación escribe y lee a través del padre, así que no necesita privilegios
-- sobre la partición, y no tenerlos cierra la vía de acceso directo.
CREATE OR REPLACE FUNCTION audit_log_ensure_partition(month_start date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  partition_name text := format('audit_log_%s', to_char(month_start, 'YYYY_MM'));
  lower_bound timestamptz := (date_trunc('month', month_start::timestamp) AT TIME ZONE 'UTC');
  upper_bound timestamptz := (date_trunc('month', month_start::timestamp) + interval '1 month') AT TIME ZONE 'UTC';
  role_name text;
BEGIN
  IF to_regclass(format('public.%I', partition_name)) IS NOT NULL THEN
    RETURN partition_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE public.%I PARTITION OF public.audit_log FOR VALUES FROM (%L) TO (%L)',
    partition_name, lower_bound, upper_bound);

  EXECUTE format(
    'CREATE TRIGGER audit_log_reject_truncate BEFORE TRUNCATE ON public.%I'
    ' FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation()', partition_name);

  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', partition_name);
  FOREACH role_name IN ARRAY ARRAY['agency_app', 'agency_worker', 'agency_readonly'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM %I', partition_name, role_name);
    END IF;
  END LOOP;

  RETURN partition_name;
END;
$$;
--> statement-breakpoint

-- Crea las particiones de los próximos meses y, si hay retención definida, borra las
-- vencidas. `retention_months = 0` (el valor sembrado) no borra nada: la retención real
-- es OQ-08 y sigue abierta, así que el sistema conserva todo hasta que la clienta la fije.
CREATE OR REPLACE FUNCTION audit_log_maintain(months_ahead int DEFAULT 2, retention_months int DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  created text[] := ARRAY[]::text[];
  dropped text[] := ARRAY[]::text[];
  current_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  target date;
  cutoff date;
  partition record;
  partition_month date;
BEGIN
  IF months_ahead IS NULL OR months_ahead < 0 OR months_ahead > 24 THEN
    RAISE EXCEPTION 'months_ahead must be between 0 and 24';
  END IF;

  FOR i IN 0..months_ahead LOOP
    target := (current_month + make_interval(months => i))::date;
    IF to_regclass(format('public.audit_log_%s', to_char(target, 'YYYY_MM'))) IS NULL THEN
      created := created || audit_log_ensure_partition(target);
    END IF;
  END LOOP;

  IF retention_months IS NOT NULL AND retention_months > 0 THEN
    cutoff := (current_month - make_interval(months => retention_months))::date;
    FOR partition IN
      SELECT child.relname
      FROM pg_inherits inh
      INNER JOIN pg_class child ON child.oid = inh.inhrelid
      WHERE inh.inhparent = 'public.audit_log'::regclass
        AND child.relname ~ '^audit_log_[0-9]{4}_[0-9]{2}$'
      ORDER BY child.relname
    LOOP
      partition_month := to_date(right(partition.relname, 7), 'YYYY_MM');
      IF partition_month < cutoff THEN
        EXECUTE format('DROP TABLE public.%I', partition.relname);
        dropped := dropped || partition.relname;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('created', to_jsonb(created), 'dropped', to_jsonb(dropped));
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION audit_log_ensure_partition(date) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION audit_log_maintain(int, int) FROM PUBLIC;
--> statement-breakpoint

-- Particiones de los meses que ya tienen filas, más el mes actual y los dos siguientes.
DO $$
DECLARE
  month_start date;
BEGIN
  FOR month_start IN
    SELECT DISTINCT date_trunc('month', occurred_at AT TIME ZONE 'UTC')::date
    FROM audit_log_legacy
    ORDER BY 1
  LOOP
    PERFORM audit_log_ensure_partition(month_start);
  END LOOP;
  PERFORM audit_log_maintain(2, 0);
END $$;
--> statement-breakpoint

-- Red de seguridad: si el job de mantenimiento no corriera, un INSERT fuera de rango
-- seguiría entrando aquí en vez de fallar. La auditoría nunca debe perder una escritura.
CREATE TABLE "audit_log_default" PARTITION OF "audit_log" DEFAULT;
--> statement-breakpoint
CREATE TRIGGER "audit_log_reject_truncate" BEFORE TRUNCATE ON "audit_log_default"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint

INSERT INTO "audit_log" (
  "id", "occurred_at", "actor_type", "actor_user_id", "actor_device_id", "action",
  "entity_type", "entity_id", "result", "ip", "request_id", "metadata"
) OVERRIDING SYSTEM VALUE
SELECT
  "id", "occurred_at", "actor_type", "actor_user_id", "actor_device_id", "action",
  "entity_type", "entity_id", "result", "ip", "request_id", "metadata"
FROM "audit_log_legacy";
--> statement-breakpoint

SELECT setval(
  pg_get_serial_sequence('audit_log', 'id'),
  GREATEST((SELECT COALESCE(max("id"), 0) FROM "audit_log"), 1),
  (SELECT COUNT(*) > 0 FROM "audit_log")
);
--> statement-breakpoint

DROP TABLE "audit_log_legacy";
--> statement-breakpoint

-- Se recrean sobre el padre: el trigger de fila se propaga a las particiones existentes y
-- se clona en las futuras; el de TRUNCATE solo cubre `TRUNCATE audit_log`, y de la vía
-- directa por partición se encarga audit_log_ensure_partition.
CREATE TRIGGER "audit_log_reject_row_mutation"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint
CREATE TRIGGER "audit_log_reject_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint

DO $$
DECLARE
  partition_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agency_owner') THEN
    ALTER TABLE audit_log OWNER TO agency_owner;
    -- Las particiones creadas por esta migración pertenecen a quien la ejecuta. Las que
    -- cree el job despues heredan agency_owner sin ayuda, porque audit_log_ensure_partition
    -- es SECURITY DEFINER y para entonces ya es suya.
    FOR partition_name IN
      SELECT child.relname
      FROM pg_inherits inh
      INNER JOIN pg_class child ON child.oid = inh.inhrelid
      WHERE inh.inhparent = 'public.audit_log'::regclass
    LOOP
      EXECUTE format('ALTER TABLE public.%I OWNER TO agency_owner', partition_name);
    END LOOP;
    ALTER FUNCTION audit_log_ensure_partition(date) OWNER TO agency_owner;
    ALTER FUNCTION audit_log_maintain(int, int) OWNER TO agency_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agency_app') THEN
    GRANT SELECT, INSERT ON audit_log TO agency_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM agency_app;
    GRANT EXECUTE ON FUNCTION audit_log_maintain(int, int) TO agency_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agency_readonly') THEN
    GRANT SELECT ON audit_log TO agency_readonly;
  END IF;
END $$;
