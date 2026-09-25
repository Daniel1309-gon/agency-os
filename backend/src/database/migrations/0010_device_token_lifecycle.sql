ALTER TABLE "devices" ADD COLUMN "enrollment_code_expires_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "devices_pending_enrollment_idx" ON "devices" USING btree ("enrollment_code_hash") WHERE "status" = 'PENDING' AND "enrollment_code_hash" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REVOKED'));
