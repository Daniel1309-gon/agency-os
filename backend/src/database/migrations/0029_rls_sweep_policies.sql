-- Production-role RLS write sweep fixes (batch 4):
-- 1. CafeteriaController.updateStatus grants `cafeteria.manage` to both CAFETERIA and
--    DIRECTOR_OPERATIVO, so DIRECTOR_OPERATIVO also inserts the DELIVERED debit under
--    agency_app. Keep the exact delivered-order, operator and negated-total checks.
-- 2. VaultService.recordGrantReuse marks `reuse_attempted` and returns `profile_id`
--    inside an internal security bookkeeping transaction (`JOB`). Migration 0004 and
--    0014 already admit `JOB` for INSERT/UPDATE on `credential_access_log`; SELECT
--    also needs `JOB` so `UPDATE ... WHERE grant_jti = $1 RETURNING profile_id` does
--    not silently filter out rows when the assignment ended or another operator
--    replays a grant, without widening OPERADOR or COORDINADOR access.

DROP POLICY IF EXISTS "account_cafeteria_delivery_debit" ON "operator_account_entries";
CREATE POLICY "account_cafeteria_delivery_debit" ON "operator_account_entries"
  FOR INSERT WITH CHECK (
    current_setting('app.role_code', true) IN ('CAFETERIA', 'DIRECTOR_OPERATIVO')
    AND entry_type = 'DEBIT_CAFETERIA'
    AND reference_type = 'cafeteria_order'
    AND EXISTS (
      SELECT 1 FROM cafeteria_orders o
      WHERE o.id = reference_id
        AND o.operator_id = operator_account_entries.operator_id
        AND o.status = 'DELIVERED'
        AND operator_account_entries.amount_cop = -o.total_cop
    )
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "credential_access_audit_scope" ON "credential_access_log";
CREATE POLICY "credential_access_audit_scope" ON "credential_access_log"
  FOR SELECT USING (
    app_can_access_profile(profile_id)
    OR current_setting('app.role_code', true) = 'JOB'
  );
