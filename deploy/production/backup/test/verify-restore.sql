DO $$
BEGIN
  IF (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.demo'::regclass) <> 'agency_owner' THEN
    RAISE EXCEPTION 'demo owner was not restored as agency_owner';
  END IF;
  IF NOT has_table_privilege('agency_app', 'public.demo', 'SELECT') THEN
    RAISE EXCEPTION 'agency_app lost SELECT on demo';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_default_acl
    WHERE defaclrole = 'agency_owner'::regrole
      AND defaclnamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'default table ACL was not restored';
  END IF;
END $$;
