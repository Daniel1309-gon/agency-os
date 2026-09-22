-- Version de autorizacion por usuario (plan 2026-09-20, fase C1).
-- El JWT lleva `av`; el guard HTTP y el handshake WebSocket lo comparan con la
-- fila vigente. Subir la version invalida cualquier token anterior del usuario.
ALTER TABLE users ADD COLUMN auth_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE users ADD CONSTRAINT users_auth_version_positive CHECK (auth_version > 0);
--> statement-breakpoint
GRANT SELECT (auth_version) ON TABLE users TO agency_readonly;
--> statement-breakpoint
ALTER TABLE users OWNER TO agency_owner;
