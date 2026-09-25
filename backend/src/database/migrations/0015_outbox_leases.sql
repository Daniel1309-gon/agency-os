-- A lease binds completion to the worker that claimed the event. Without the
-- token, a slow worker could mark SENT after another worker reclaimed its
-- expired PROCESSING lease.
ALTER TABLE "outbox_events" ADD COLUMN "claimed_by" text;
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "outbox_events"
SET "status" = 'FAILED', "next_attempt_at" = now()
WHERE "status" = 'PROCESSING' AND "lease_expires_at" IS NULL;
