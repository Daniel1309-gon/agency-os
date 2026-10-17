-- OQ-01/OQ-02: the operational director is global, while a coordinator is
-- restricted to operators in their active crew. Keep the same decision in
-- PostgreSQL so an application query cannot widen a service-level scope.
CREATE OR REPLACE FUNCTION app_can_access_operator(target_operator_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR target_operator_id::text = current_setting('app.user_id', true)
    OR (
      current_setting('app.role_code', true) = 'COORDINADOR'
      AND EXISTS (
        SELECT 1
        FROM crew_members member
        INNER JOIN crews crew ON crew.id = member.crew_id
        WHERE member.user_id = target_operator_id
          AND member.valid_range @> now()
          AND crew.coordinator_id::text = current_setting('app.user_id', true)
          AND crew.is_active = true
      )
    );
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_can_access_profile(target_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR EXISTS (
      SELECT 1
      FROM profile_assignments assignment
      WHERE assignment.profile_id = target_profile_id
        AND assignment.operator_id::text = current_setting('app.user_id', true)
        AND assignment.status IN ('SCHEDULED', 'ACTIVE')
        AND assignment.valid_range @> now()
    )
    OR (
      current_setting('app.role_code', true) = 'COORDINADOR'
      AND EXISTS (
        SELECT 1
        FROM profile_assignments assignment
        INNER JOIN crew_members member ON member.user_id = assignment.operator_id
        INNER JOIN crews crew ON crew.id = member.crew_id
        WHERE assignment.profile_id = target_profile_id
          AND assignment.status IN ('SCHEDULED', 'ACTIVE')
          AND assignment.valid_range @> now()
          AND member.valid_range @> now()
          AND crew.coordinator_id::text = current_setting('app.user_id', true)
          AND crew.is_active = true
      )
    );
$$;
--> statement-breakpoint

DROP POLICY IF EXISTS "tt_credentials_operator_scope" ON "tt_profile_credentials";
CREATE POLICY "tt_credentials_operator_scope" ON "tt_profile_credentials"
  FOR SELECT USING (app_can_access_profile(profile_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "tt_credentials_admin_write" ON "tt_profile_credentials";
CREATE POLICY "tt_credentials_admin_write" ON "tt_profile_credentials"
  FOR INSERT WITH CHECK (current_setting('app.role_code', true) = 'ADMIN');
--> statement-breakpoint

DROP POLICY IF EXISTS "tt_credentials_admin_update" ON "tt_profile_credentials";
CREATE POLICY "tt_credentials_admin_update" ON "tt_profile_credentials"
  FOR UPDATE USING (current_setting('app.role_code', true) = 'ADMIN')
  WITH CHECK (current_setting('app.role_code', true) = 'ADMIN');
--> statement-breakpoint

DROP POLICY IF EXISTS "points_operator_scope" ON "points_ledger";
CREATE POLICY "points_operator_scope" ON "points_ledger"
  FOR SELECT USING (app_can_access_operator(operator_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "payroll_operator_scope" ON "payroll_lines";
CREATE POLICY "payroll_operator_scope" ON "payroll_lines"
  FOR SELECT USING (app_can_access_operator(operator_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "account_operator_scope" ON "operator_account_entries";
CREATE POLICY "account_operator_scope" ON "operator_account_entries"
  FOR SELECT USING (app_can_access_operator(operator_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "icebreaker_operator_scope" ON "icebreakers";
CREATE POLICY "icebreaker_operator_read" ON "icebreakers"
  FOR SELECT USING (app_can_access_operator(operator_id));
--> statement-breakpoint
CREATE POLICY "icebreaker_operator_insert" ON "icebreakers"
  FOR INSERT WITH CHECK (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR operator_id::text = current_setting('app.user_id', true)
  );
--> statement-breakpoint
CREATE POLICY "icebreaker_reviewer_update" ON "icebreakers"
  FOR UPDATE USING (app_can_access_operator(operator_id))
  WITH CHECK (app_can_access_operator(operator_id));
--> statement-breakpoint
CREATE POLICY "icebreaker_operator_delete" ON "icebreakers"
  FOR DELETE USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO')
    OR operator_id::text = current_setting('app.user_id', true)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "points_system_write" ON "points_ledger";
CREATE POLICY "points_system_write" ON "points_ledger"
  FOR INSERT WITH CHECK (current_setting('app.role_code', true) IN ('ADMIN', 'JOB'));
--> statement-breakpoint

DROP POLICY IF EXISTS "payroll_system_write" ON "payroll_lines";
CREATE POLICY "payroll_system_write" ON "payroll_lines"
  FOR ALL USING (current_setting('app.role_code', true) IN ('ADMIN', 'JOB'))
  WITH CHECK (current_setting('app.role_code', true) IN ('ADMIN', 'JOB'));
--> statement-breakpoint

DROP POLICY IF EXISTS "account_system_write" ON "operator_account_entries";
CREATE POLICY "account_system_write" ON "operator_account_entries"
  FOR INSERT WITH CHECK (current_setting('app.role_code', true) IN ('ADMIN', 'JOB'));
--> statement-breakpoint

DROP POLICY IF EXISTS "credential_access_audit_scope" ON "credential_access_log";
CREATE POLICY "credential_access_audit_scope" ON "credential_access_log"
  FOR SELECT USING (app_can_access_profile(profile_id));
--> statement-breakpoint

DROP POLICY IF EXISTS "credential_access_append" ON "credential_access_log";
CREATE POLICY "credential_access_append" ON "credential_access_log"
  FOR INSERT WITH CHECK (
    current_setting('app.role_code', true) IN ('ADMIN', 'JOB')
    OR user_id::text = current_setting('app.user_id', true)
  );
