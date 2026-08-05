CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
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
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "breaks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"scheduled_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_minutes" integer,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cafeteria_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"unit_price_cop" numeric(12, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cop" numeric(12, 2) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "cafeteria_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "cafeteria_orders_order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operator_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'PLACED' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"pickup_deadline_at" timestamp with time zone,
	"total_cop" numeric(12, 2) DEFAULT '0' NOT NULL,
	"delivered_by" uuid,
	"cancel_reason" text,
	"notes" text,
	"idempotency_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cafeteria_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"price_cop" numeric(12, 2) NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"prep_minutes" smallint,
	"pickup_deadline_minutes" smallint DEFAULT 30 NOT NULL,
	"image_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cafeteria_products_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
CREATE TABLE "competition_participants" (
	"competition_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"current_value" numeric(14, 4) DEFAULT '0' NOT NULL,
	"final_rank" integer,
	"awarded_cop" numeric(14, 2),
	"awarded_at" timestamp with time zone,
	CONSTRAINT "competition_participants_competition_id_operator_id_pk" PRIMARY KEY("competition_id","operator_id")
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metric" varchar(24) NOT NULL,
	"scope" varchar(16) NOT NULL,
	"crew_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prize_scheme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_access_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credential_access_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"profile_id" uuid NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"assignment_id" uuid,
	"purpose" varchar(32) NOT NULL,
	"granted" boolean NOT NULL,
	"deny_reason" varchar(32),
	"grant_jti" uuid,
	"consumed_at" timestamp with time zone,
	"reuse_attempted" boolean DEFAULT false NOT NULL,
	"ip" "inet",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"valid_range" "tstzrange"
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"coordinator_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostname" text NOT NULL,
	"label" text NOT NULL,
	"assigned_operator_id" uuid,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"enrollment_code_hash" text,
	"token_hash" text,
	"token_issued_at" timestamp with time zone,
	"token_expires_at" timestamp with time zone,
	"extension_version" text,
	"helper_version" text,
	"os_version" text,
	"last_seen_at" timestamp with time zone,
	"last_ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text
);
--> statement-breakpoint
CREATE TABLE "encryption_keys" (
	"version" integer PRIMARY KEY NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"algorithm" text DEFAULT 'AES-256-GCM' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "etl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"view_id" uuid,
	"business_date" date NOT NULL,
	"status" varchar(16) DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"row_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"checksum" text
);
--> statement-breakpoint
CREATE TABLE "etl_staging_rows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "etl_staging_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"etl_run_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_row" jsonb NOT NULL,
	"validation_status" varchar(16) NOT NULL,
	"validation_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"rollout" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" varchar(16) NOT NULL,
	"operator_id" uuid,
	"crew_id" uuid,
	"period_id" uuid NOT NULL,
	"target_points" numeric(14, 4) NOT NULL,
	"bonus_type" varchar(16) NOT NULL,
	"bonus_cop" numeric(14, 2),
	"tiers" jsonb,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icebreaker_effectiveness" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"profile_id" uuid,
	"business_date" date NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"replied" integer DEFAULT 0 NOT NULL,
	"response_rate" numeric(6, 4),
	"score" numeric(6, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icebreaker_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"icebreaker_id" uuid NOT NULL,
	"evaluator" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"score" numeric(6, 4),
	"model" text,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token_cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icebreaker_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"icebreaker_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"verdict" varchar(24) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icebreaker_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(16) NOT NULL,
	"pattern" text,
	"severity" varchar(16) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "icebreaker_rules_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "icebreaker_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"icebreaker_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"severity" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icebreakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"profile_id" uuid,
	"text" text NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"type" varchar(8) NOT NULL,
	"target_countries" char(2)[],
	"daily_limit" integer NOT NULL,
	"hourly_limit" integer NOT NULL,
	"active_hours" jsonb,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "interaction_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"campaign_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"session_id" uuid,
	"target_external_ref" text NOT NULL,
	"type" varchar(8) NOT NULL,
	"status" varchar(16) DEFAULT 'QUEUED' NOT NULL,
	"executed_at" timestamp with time zone,
	"error" text,
	"dedupe_key" text NOT NULL,
	CONSTRAINT "interaction_events_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "ip_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"cidr" "cidr",
	"scope" varchar(8) DEFAULT 'ALL' NOT NULL,
	"role_id" uuid,
	"user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email_attempted" text NOT NULL,
	"user_id" uuid,
	"ip" "inet",
	"outcome" varchar(32) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "metric_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"dedupe_key" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"operator_id" uuid,
	"session_id" uuid,
	"event_type" text NOT NULL,
	"points" numeric(14, 4),
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "metric_reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"extension_points" numeric(14, 4) DEFAULT '0' NOT NULL,
	"tableau_points" numeric(14, 4) DEFAULT '0' NOT NULL,
	"difference_points" numeric(14, 4) DEFAULT '0' NOT NULL,
	"tolerance_points" numeric(14, 4) DEFAULT '0' NOT NULL,
	"status" varchar(24) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" varchar(16) NOT NULL,
	"channels" varchar(16) NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_account_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operator_account_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operator_id" uuid NOT NULL,
	"entry_type" varchar(32) NOT NULL,
	"amount_cop" numeric(14, 2) NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"period_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_compensation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"commission_rate" numeric(5, 4) NOT NULL,
	"points_to_cop_rate" numeric(12, 4) NOT NULL,
	"monthly_goal_points" numeric(14, 4),
	"max_concurrent_profiles" smallint DEFAULT 1 NOT NULL,
	"valid_range" "tstzrange",
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_current_status" (
	"operator_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(16) NOT NULL,
	"reason" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_status_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "operator_status_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operator_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid,
	"payload" jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_id" uuid NOT NULL,
	"type" varchar(16) NOT NULL,
	"amount_cop" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"format" varchar(8) DEFAULT 'XLSX' NOT NULL,
	"file_uri" text NOT NULL,
	"checksum" text NOT NULL,
	"row_count" integer NOT NULL,
	"generated_by" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"points_total" numeric(14, 4) NOT NULL,
	"commission_rate_snapshot" numeric(5, 4) NOT NULL,
	"points_to_cop_rate_snapshot" numeric(12, 4) NOT NULL,
	"gross_cop" numeric(14, 2) NOT NULL,
	"net_cop" numeric(14, 2) NOT NULL,
	"status" varchar(16) DEFAULT 'DRAFT' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone,
	"computed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"default_points_to_cop_rate" numeric(12, 4) NOT NULL,
	"locked_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "points_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "points_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"operator_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"assignment_id" uuid,
	"business_date" date NOT NULL,
	"shift_business_date" date NOT NULL,
	"points" numeric(14, 4) NOT NULL,
	"source" varchar(16) NOT NULL,
	"attribution_method" varchar(24) DEFAULT 'DIRECT' NOT NULL,
	"attribution_basis" jsonb,
	"source_hour" timestamp with time zone,
	"reference_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"shift_id" uuid,
	"valid_range" "tstzrange",
	"status" varchar(16) DEFAULT 'SCHEDULED' NOT NULL,
	"assigned_by" uuid NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_daily_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"source" varchar(16) NOT NULL,
	"messages_sent" integer DEFAULT 0 NOT NULL,
	"responses" integer DEFAULT 0 NOT NULL,
	"points" numeric(14, 4) DEFAULT '0' NOT NULL,
	"icebreakers_sent" integer DEFAULT 0 NOT NULL,
	"icebreakers_replied" integer DEFAULT 0 NOT NULL,
	"response_rate" numeric(6, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"operator_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"chrome_profile_dir" text NOT NULL,
	"status" varchar(16) DEFAULT 'LAUNCHING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" varchar(32),
	"error_code" text,
	"error_detail" text
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"revoked_reason" varchar(32),
	"ip" "inet",
	"user_agent" text,
	"device_id" uuid,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "rocketchat_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" uuid,
	"rc_room_id" text NOT NULL,
	"name" text NOT NULL,
	"type" varchar(8) NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "rocketchat_channels_rc_room_id_unique" UNIQUE("rc_room_id")
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid,
	"target_user_id" uuid,
	"body" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"recurrence_rule" text,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"sent_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"range" "tstzrange",
	"type" varchar(32) NOT NULL,
	"reason" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"crew_id" uuid,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"weekdays" smallint[] NOT NULL,
	"break_minutes" smallint DEFAULT 0 NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"template_id" uuid,
	"business_date" date NOT NULL,
	"scheduled_range" "tstzrange",
	"actual_start_at" timestamp with time zone,
	"actual_end_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'SCHEDULED' NOT NULL,
	"effective_minutes" integer,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tableau_hourly_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"view_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"source_hour" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"points" numeric(14, 4) NOT NULL,
	"raw_row" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"etl_run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "tableau_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"site_id" text NOT NULL,
	"view_id" text NOT NULL,
	"source_timezone" text DEFAULT 'America/Bogota' NOT NULL,
	"kind" varchar(32) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"column_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tt_profile_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"username" text NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"secret_nonce" "bytea" NOT NULL,
	"secret_tag" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"aad_context" text NOT NULL,
	"version" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tt_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"login_email" text NOT NULL,
	"external_ref" text,
	"country" char(2),
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"chrome_profile_dir" text,
	"notes" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_device_id_devices_id_fk" FOREIGN KEY ("actor_device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "breaks" ADD CONSTRAINT "breaks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cafeteria_order_items" ADD CONSTRAINT "cafeteria_order_items_order_id_cafeteria_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."cafeteria_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cafeteria_order_items" ADD CONSTRAINT "cafeteria_order_items_product_id_cafeteria_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cafeteria_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cafeteria_orders" ADD CONSTRAINT "cafeteria_orders_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cafeteria_orders" ADD CONSTRAINT "cafeteria_orders_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_participants" ADD CONSTRAINT "competition_participants_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_participants" ADD CONSTRAINT "competition_participants_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitions" ADD CONSTRAINT "competitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access_log" ADD CONSTRAINT "credential_access_log_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crew_members" ADD CONSTRAINT "crew_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crews" ADD CONSTRAINT "crews_coordinator_id_users_id_fk" FOREIGN KEY ("coordinator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_assigned_operator_id_users_id_fk" FOREIGN KEY ("assigned_operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl_runs" ADD CONSTRAINT "etl_runs_view_id_tableau_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."tableau_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "etl_staging_rows" ADD CONSTRAINT "etl_staging_rows_etl_run_id_etl_runs_id_fk" FOREIGN KEY ("etl_run_id") REFERENCES "public"."etl_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_effectiveness" ADD CONSTRAINT "icebreaker_effectiveness_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_effectiveness" ADD CONSTRAINT "icebreaker_effectiveness_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_evaluations" ADD CONSTRAINT "icebreaker_evaluations_icebreaker_id_icebreakers_id_fk" FOREIGN KEY ("icebreaker_id") REFERENCES "public"."icebreakers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_reviews" ADD CONSTRAINT "icebreaker_reviews_icebreaker_id_icebreakers_id_fk" FOREIGN KEY ("icebreaker_id") REFERENCES "public"."icebreakers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_reviews" ADD CONSTRAINT "icebreaker_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_rules" ADD CONSTRAINT "icebreaker_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_violations" ADD CONSTRAINT "icebreaker_violations_icebreaker_id_icebreakers_id_fk" FOREIGN KEY ("icebreaker_id") REFERENCES "public"."icebreakers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_violations" ADD CONSTRAINT "icebreaker_violations_rule_id_icebreaker_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."icebreaker_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreaker_violations" ADD CONSTRAINT "icebreaker_violations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreakers" ADD CONSTRAINT "icebreakers_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icebreakers" ADD CONSTRAINT "icebreakers_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_campaigns" ADD CONSTRAINT "interaction_campaigns_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_campaigns" ADD CONSTRAINT "interaction_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_campaign_id_interaction_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."interaction_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_events" ADD CONSTRAINT "interaction_events_session_id_profile_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."profile_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_allowlist" ADD CONSTRAINT "ip_allowlist_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_allowlist" ADD CONSTRAINT "ip_allowlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_allowlist" ADD CONSTRAINT "ip_allowlist_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD CONSTRAINT "login_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events" ADD CONSTRAINT "metric_events_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events" ADD CONSTRAINT "metric_events_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_events" ADD CONSTRAINT "metric_events_session_id_profile_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."profile_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_reconciliation" ADD CONSTRAINT "metric_reconciliation_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_account_entries" ADD CONSTRAINT "operator_account_entries_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_account_entries" ADD CONSTRAINT "operator_account_entries_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_account_entries" ADD CONSTRAINT "operator_account_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_compensation" ADD CONSTRAINT "operator_compensation_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_compensation" ADD CONSTRAINT "operator_compensation_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_current_status" ADD CONSTRAINT "operator_current_status_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_status_events" ADD CONSTRAINT "operator_status_events_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_line_id_payroll_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_exports" ADD CONSTRAINT "payroll_exports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_computed_by_users_id_fk" FOREIGN KEY ("computed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_assignment_id_profile_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."profile_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_assignments" ADD CONSTRAINT "profile_assignments_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_assignments" ADD CONSTRAINT "profile_assignments_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_assignments" ADD CONSTRAINT "profile_assignments_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_assignments" ADD CONSTRAINT "profile_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_daily_metrics" ADD CONSTRAINT "profile_daily_metrics_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_sessions" ADD CONSTRAINT "profile_sessions_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_sessions" ADD CONSTRAINT "profile_sessions_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_sessions" ADD CONSTRAINT "profile_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_sessions" ADD CONSTRAINT "profile_sessions_assignment_id_profile_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."profile_assignments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rocketchat_channels" ADD CONSTRAINT "rocketchat_channels_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_channel_id_rocketchat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."rocketchat_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_overrides" ADD CONSTRAINT "shift_overrides_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_overrides" ADD CONSTRAINT "shift_overrides_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_crew_id_crews_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_operator_id_users_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_template_id_shift_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tableau_hourly_points" ADD CONSTRAINT "tableau_hourly_points_view_id_tableau_views_id_fk" FOREIGN KEY ("view_id") REFERENCES "public"."tableau_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tableau_hourly_points" ADD CONSTRAINT "tableau_hourly_points_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tableau_views" ADD CONSTRAINT "tableau_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_profile_credentials" ADD CONSTRAINT "tt_profile_credentials_profile_id_tt_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."tt_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_profile_credentials" ADD CONSTRAINT "tt_profile_credentials_key_version_encryption_keys_version_fk" FOREIGN KEY ("key_version") REFERENCES "public"."encryption_keys"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tt_profile_credentials" ADD CONSTRAINT "tt_profile_credentials_rotated_by_users_id_fk" FOREIGN KEY ("rotated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cafeteria_orders_operator_idempotency" ON "cafeteria_orders" USING btree ("operator_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "crew_members_valid_range_idx" ON "crew_members" USING btree ("crew_id","valid_range");--> statement-breakpoint
CREATE UNIQUE INDEX "etl_runs_view_date_unique" ON "etl_runs" USING btree ("view_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "metric_event_dedupe" ON "metric_events" USING btree ("dedupe_key","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_account_entry_per_reference" ON "operator_account_entries" USING btree ("reference_type","reference_id","entry_type");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_period_operator_unique" ON "payroll_lines" USING btree ("period_id","operator_id");--> statement-breakpoint
CREATE INDEX "profile_assignments_range_idx" ON "profile_assignments" USING btree ("profile_id","valid_range");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_daily_metrics_unique" ON "profile_daily_metrics" USING btree ("profile_id","business_date","source");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_single_live_session" ON "profile_sessions" USING btree ("profile_id") WHERE "profile_sessions"."status" IN ('LAUNCHING', 'ACTIVE');--> statement-breakpoint
CREATE UNIQUE INDEX "tableau_hourly_points_unique" ON "tableau_hourly_points" USING btree ("view_id","profile_id","source_hour");--> statement-breakpoint
CREATE UNIQUE INDEX "one_current_credential_per_profile" ON "tt_profile_credentials" USING btree ("profile_id") WHERE "tt_profile_credentials"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "tt_profiles_login_email_unique" ON "tt_profiles" USING btree ("login_email") WHERE "tt_profiles"."deleted_at" IS NULL;
--> statement-breakpoint

-- Invariantes de concurrencia: la base de datos es la autoridad con dos instancias del API.
ALTER TABLE "crew_members"
  ADD CONSTRAINT "crew_members_no_overlap"
  EXCLUDE USING gist ("user_id" WITH =, "valid_range" WITH &&);
--> statement-breakpoint
ALTER TABLE "operator_compensation"
  ADD CONSTRAINT "operator_compensation_no_overlap"
  EXCLUDE USING gist ("operator_id" WITH =, "valid_range" WITH &&);
--> statement-breakpoint
ALTER TABLE "profile_assignments"
  ADD CONSTRAINT "profile_assignments_no_overlap"
  EXCLUDE USING gist ("profile_id" WITH =, "valid_range" WITH &&)
  WHERE ("status" <> 'CANCELLED');
--> statement-breakpoint
ALTER TABLE "profile_assignments"
  ADD CONSTRAINT "profile_assignments_half_open"
  CHECK (lower_inc("valid_range") AND NOT upper_inc("valid_range"));
--> statement-breakpoint
ALTER TABLE "shifts"
  ADD CONSTRAINT "shifts_no_overlap"
  EXCLUDE USING gist ("operator_id" WITH =, "scheduled_range" WITH &&)
  WHERE ("status" <> 'CANCELLED');
--> statement-breakpoint
ALTER TABLE "scheduled_messages"
  ADD CONSTRAINT "scheduled_messages_exactly_one_target"
  CHECK (("channel_id" IS NULL) <> ("target_user_id" IS NULL));
--> statement-breakpoint
ALTER TABLE "operator_compensation"
  ADD CONSTRAINT "operator_compensation_rate_range"
  CHECK ("commission_rate" >= 0 AND "commission_rate" <= 1);
--> statement-breakpoint
ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_no_secret_keys"
  CHECK (NOT jsonb_exists_any("metadata", ARRAY[
    'password','contrasena','contraseña','secret','plaintext',
    'credential','credentialValue','secret_ciphertext','token'
  ]));
--> statement-breakpoint

-- Los roles pueden no existir todavía en instalaciones locales; las revocaciones
-- se aplican cuando el despliegue crea los roles de base de datos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agency_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM agency_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agency_readonly') THEN
    REVOKE SELECT ON tt_profile_credentials FROM agency_readonly;
    GRANT SELECT (id, profile_id, username, version, is_current, rotated_at)
      ON tt_profile_credentials TO agency_readonly;
  END IF;
END $$;
--> statement-breakpoint

-- Defensa en profundidad: los servicios deben usar SET LOCAL app.user_id/app.role_code
-- dentro de una transacción por request.
ALTER TABLE "tt_profile_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "points_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operator_account_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "icebreakers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credential_access_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tt_credentials_operator_scope" ON "tt_profile_credentials"
  FOR SELECT USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR EXISTS (
      SELECT 1 FROM profile_assignments a
      WHERE a.profile_id = tt_profile_credentials.profile_id
        AND a.operator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND a.status IN ('SCHEDULED', 'ACTIVE')
        AND a.valid_range @> now()
    )
  );
--> statement-breakpoint
CREATE POLICY "tt_credentials_admin_write" ON "tt_profile_credentials"
  FOR INSERT WITH CHECK (current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO'));
--> statement-breakpoint
CREATE POLICY "tt_credentials_admin_update" ON "tt_profile_credentials"
  FOR UPDATE USING (current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO'))
  WITH CHECK (current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO'));
--> statement-breakpoint
CREATE POLICY "points_operator_scope" ON "points_ledger"
  FOR SELECT USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR operator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "points_system_write" ON "points_ledger"
  FOR INSERT WITH CHECK (current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'JOB'));
--> statement-breakpoint
CREATE POLICY "payroll_operator_scope" ON "payroll_lines"
  FOR SELECT USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR operator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "payroll_system_write" ON "payroll_lines"
  FOR ALL USING (current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'JOB'))
  WITH CHECK (current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'JOB'));
--> statement-breakpoint
CREATE POLICY "account_operator_scope" ON "operator_account_entries"
  FOR SELECT USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR operator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "account_system_write" ON "operator_account_entries"
  FOR INSERT WITH CHECK (current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'JOB'));
--> statement-breakpoint
CREATE POLICY "icebreaker_operator_scope" ON "icebreakers"
  FOR ALL USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR operator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ) WITH CHECK (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR operator_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "credential_access_append" ON "credential_access_log"
  FOR INSERT WITH CHECK (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'JOB')
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "credential_access_audit_scope" ON "credential_access_log"
  FOR SELECT USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION reject_write_on_closed_period() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM payroll_periods p
    WHERE NEW.business_date BETWEEN p.starts_on AND p.ends_on
      AND p.status IN ('CLOSED', 'PAID')
  ) THEN
    RAISE EXCEPTION 'payroll period closed for business_date %', NEW.business_date
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "points_ledger_closed_period_guard"
  BEFORE INSERT OR UPDATE ON "points_ledger"
  FOR EACH ROW EXECUTE FUNCTION reject_write_on_closed_period();
--> statement-breakpoint
CREATE TRIGGER "operator_account_closed_period_guard"
  BEFORE INSERT OR UPDATE ON "operator_account_entries"
  FOR EACH ROW EXECUTE FUNCTION reject_write_on_closed_period();
