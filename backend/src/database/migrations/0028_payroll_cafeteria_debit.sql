-- FR-35: the payroll line records the period's cafeteria consumption (debits net of
-- refunds, as a positive amount to deduct). Existing lines default to zero; they are
-- recomputed while their period is open.
ALTER TABLE "payroll_lines" ADD COLUMN IF NOT EXISTS "cafeteria_debit_cop" numeric(14, 2) DEFAULT '0' NOT NULL;
