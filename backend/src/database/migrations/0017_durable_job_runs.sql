-- Durable job identity and lease state. Business tables remain the source of
-- truth for reconstructible work; this table only records executions whose
-- cadence and fencing cannot live in a process timer.
CREATE TABLE "job_runs" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "job_name" text NOT NULL,
  "run_key" text NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'PENDING',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "claimed_by" text,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "job_runs_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD')),
  CONSTRAINT "job_runs_attempts_check" CHECK ("attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_job_key_uq" ON "job_runs" USING btree ("job_name", "run_key");
--> statement-breakpoint
CREATE INDEX "job_runs_due_idx" ON "job_runs" USING btree ("status", "next_attempt_at", "scheduled_for");
--> statement-breakpoint
ALTER TABLE "job_runs" OWNER TO agency_owner;
--> statement-breakpoint
DO $$
DECLARE sequence_name text;
BEGIN
  sequence_name := pg_get_serial_sequence('public.job_runs', 'id');
  IF sequence_name IS NOT NULL THEN
    EXECUTE format('ALTER SEQUENCE %s OWNER TO agency_owner', sequence_name);
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "job_runs" TO agency_app, agency_worker;
--> statement-breakpoint
DO $$
DECLARE sequence_name text;
BEGIN
  sequence_name := pg_get_serial_sequence('public.job_runs', 'id');
  IF sequence_name IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO agency_app, agency_worker', sequence_name);
  END IF;
END $$;
