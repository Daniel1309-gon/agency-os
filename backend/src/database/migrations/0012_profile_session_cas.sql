ALTER TABLE "profile_sessions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "profile_sessions" ADD CONSTRAINT "profile_sessions_version_positive" CHECK ("profile_sessions"."version" > 0);
