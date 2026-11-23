-- A9: per-view daily schedule (default 09:15 America/Bogota), freshness SLA,
-- raw CSV artifact persistence for offline reprocess, and alert deduplication.

ALTER TABLE "tableau_views"
  ADD COLUMN IF NOT EXISTS "schedule_time" varchar(5) DEFAULT '09:15' NOT NULL,
  ADD COLUMN IF NOT EXISTS "schedule_timezone" text DEFAULT 'America/Bogota' NOT NULL,
  ADD COLUMN IF NOT EXISTS "freshness_sla_minutes" integer DEFAULT 120 NOT NULL;
--> statement-breakpoint
ALTER TABLE "etl_runs"
  ADD COLUMN IF NOT EXISTS "raw_csv" text,
  ADD COLUMN IF NOT EXISTS "raw_csv_bytes" integer,
  ADD COLUMN IF NOT EXISTS "alerted_at" timestamp with time zone;
