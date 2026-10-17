-- Migration 0008 revokes function execution from PUBLIC as part of the
-- deployment-role hardening. citext equality is still required for the
-- identity lookups used by seed and HTTP authentication.
-- db-migrate may already have SET ROLE agency_owner before applying a later
-- migration. The extension function remains owned by the deployment account,
-- so return to the session user for this grant. The migration session ends
-- after this file; later runs reapply their normal role setup.
RESET ROLE;
GRANT EXECUTE ON FUNCTION public.citext_eq(citext, citext)
  TO agency_owner, agency_app, agency_readonly;
