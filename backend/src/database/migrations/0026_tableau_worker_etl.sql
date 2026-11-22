-- FR-19 / decision #9: the Tableau ETL runs only in the dedicated worker, which is
-- the single process that holds the Tableau PAT (a second sign-in with the same PAT
-- ends the first session). The API only queues runs.

-- Re-executing a run (retry after FAILED, or a stale RUNNING lease) must not
-- duplicate its staging rows: the worker upserts them by run and row number.
CREATE UNIQUE INDEX IF NOT EXISTS "etl_staging_rows_run_row_unique" ON "etl_staging_rows" USING btree ("etl_run_id", "row_number");
--> statement-breakpoint

-- A view's timezone is a fact about the client's worksheet, not something to assume:
-- a one-hour offset misattributes points exactly at every handover. New views must
-- state it; existing rows keep the value they already have.
ALTER TABLE "tableau_views" ALTER COLUMN "source_timezone" DROP DEFAULT;
--> statement-breakpoint

-- Worker privileges for the ETL. Still no DELETE, and nothing on payroll,
-- credentials or audit writes.
GRANT SELECT ON TABLE tableau_views, tt_profiles TO agency_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE etl_runs, etl_staging_rows, tableau_hourly_points TO agency_worker;
--> statement-breakpoint
DO $$
DECLARE
  sequence_name text;
BEGIN
  sequence_name := pg_get_serial_sequence('public.etl_staging_rows', 'id');
  IF sequence_name IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO agency_worker', sequence_name);
  END IF;
END $$;
