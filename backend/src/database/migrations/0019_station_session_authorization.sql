ALTER TABLE profile_sessions ADD COLUMN browser_closed_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE profile_sessions OWNER TO agency_owner;
