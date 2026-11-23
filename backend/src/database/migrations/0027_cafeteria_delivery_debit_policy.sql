-- FR-35: marking an order DELIVERED writes its debit in the same transaction, as the
-- CAFETERIA role. account_system_write (0014) only admits ADMIN and JOB, and the table
-- has FORCE ROW LEVEL SECURITY, so under agency_app every delivery failed with 42501
-- and rolled back. Integration tests run as superuser and never saw it.
--
-- The kitchen may write exactly one kind of row: the debit of an order that is
-- already DELIVERED, for that order's operator and for minus its total. Nothing else.
CREATE POLICY "account_cafeteria_delivery_debit" ON "operator_account_entries"
  FOR INSERT WITH CHECK (
    current_setting('app.role_code', true) = 'CAFETERIA'
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
