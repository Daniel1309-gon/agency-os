-- Profile credential management is scoped to the profile. Encryption-key
-- rotation remains an ADMIN-only operation.
INSERT INTO permissions (code, module, description)
VALUES ('vault.keys.rotate', 'vault', 'Rotate vault encryption keys')
ON CONFLICT (code) DO UPDATE
SET module = excluded.module, description = excluded.description;
--> statement-breakpoint

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
CROSS JOIN permissions
WHERE roles.code IN ('DIRECTOR_OPERATIVO', 'COORDINADOR')
  AND permissions.code IN ('vault.rotate', 'vault.read_meta')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DELETE FROM role_permissions
USING roles, permissions
WHERE role_permissions.role_id = roles.id
  AND role_permissions.permission_id = permissions.id
  AND roles.code IN ('DIRECTOR_OPERATIVO', 'COORDINADOR')
  AND permissions.code = 'vault.keys.rotate';
--> statement-breakpoint

DROP POLICY IF EXISTS "tt_credentials_admin_write" ON tt_profile_credentials;
CREATE POLICY "tt_credentials_manager_write" ON tt_profile_credentials
  FOR INSERT WITH CHECK (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'COORDINADOR')
    AND app_can_access_profile(profile_id)
  );
--> statement-breakpoint

DROP POLICY IF EXISTS "tt_credentials_admin_update" ON tt_profile_credentials;
CREATE POLICY "tt_credentials_manager_update" ON tt_profile_credentials
  FOR UPDATE USING (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'COORDINADOR')
    AND app_can_access_profile(profile_id)
  ) WITH CHECK (
    current_setting('app.role_code', true) IN ('ADMIN', 'DIRECTOR_OPERATIVO', 'COORDINADOR')
    AND app_can_access_profile(profile_id)
  );
