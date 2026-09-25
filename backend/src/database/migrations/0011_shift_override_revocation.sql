ALTER TABLE "shift_overrides" ADD COLUMN "revoked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "shift_overrides" ADD COLUMN "revoked_by" uuid;
--> statement-breakpoint
ALTER TABLE "shift_overrides" ADD CONSTRAINT "shift_overrides_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shift_overrides_active_operator_idx" ON "shift_overrides" USING btree ("operator_id") WHERE "revoked_at" IS NULL;
