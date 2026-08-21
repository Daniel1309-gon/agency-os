-- FORCE prevents the owner role from silently bypassing row policies. The
-- application and worker roles are already non-owners; this closes the
-- migration/maintenance path as well.
ALTER TABLE "tt_profile_credentials" FORCE ROW LEVEL SECURITY;
ALTER TABLE "points_ledger" FORCE ROW LEVEL SECURITY;
ALTER TABLE "payroll_lines" FORCE ROW LEVEL SECURITY;
ALTER TABLE "operator_account_entries" FORCE ROW LEVEL SECURITY;
ALTER TABLE "icebreakers" FORCE ROW LEVEL SECURITY;
ALTER TABLE "credential_access_log" FORCE ROW LEVEL SECURITY;
