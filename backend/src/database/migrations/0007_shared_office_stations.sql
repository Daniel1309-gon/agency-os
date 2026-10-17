-- A web-prepared operator session is intentionally not tied to a workstation.
-- The approved station that requests the vault grant claims it atomically.
ALTER TABLE "profile_sessions" ALTER COLUMN "device_id" DROP NOT NULL;
