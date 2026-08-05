-- citext debe existir antes de usarse como tipo de columna.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
-- drizzle-kit genero esta linea como "undefined"."citext" (bug de su
-- introspeccion con customType: no reconoce el esquema del tipo de una
-- extension y cae a la palabra literal "undefined"). Corregido a mano.
ALTER TABLE "users" ALTER COLUMN "email" SET DATA TYPE citext;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."deleted_at" IS NULL;
