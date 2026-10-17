-- Client certificate identity (plan 2026-09-20, fases B1/B2).
-- The device principal stops being a bearer token and becomes the SHA-256
-- fingerprint of the mTLS client certificate forwarded by the trusted edge.
-- Additive only: token columns stay for history and are no longer read.
ALTER TABLE devices ADD COLUMN cert_fingerprint text;
--> statement-breakpoint
ALTER TABLE devices ADD COLUMN cert_not_after timestamp with time zone;
--> statement-breakpoint
ALTER TABLE devices ADD COLUMN device_kind varchar(16) NOT NULL DEFAULT 'STATION';
--> statement-breakpoint
ALTER TABLE devices ADD CONSTRAINT devices_device_kind_check CHECK (device_kind IN ('STATION', 'ADMIN'));
--> statement-breakpoint
-- A revoked device keeps its fingerprint for audit but releases it for reuse,
-- so a replacement PC can enrol with a reissued certificate.
CREATE UNIQUE INDEX devices_cert_fingerprint_active_idx ON devices (cert_fingerprint) WHERE cert_fingerprint IS NOT NULL AND status <> 'REVOKED';
--> statement-breakpoint
GRANT SELECT (cert_fingerprint, cert_not_after, device_kind) ON TABLE devices TO agency_readonly;
--> statement-breakpoint
ALTER TABLE devices OWNER TO agency_owner;
