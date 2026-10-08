BEGIN;

CREATE SCHEMA IF NOT EXISTS "exagram";

-- `users.email` is citext. The extension lands in `public` so the type name is stable regardless
-- of the search_path the runner or the app connects with.
CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "public";

CREATE TABLE "exagram"."workspaces" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" TEXT NOT NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "exagram"."users" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id"),
	"email" public.CITEXT NOT NULL UNIQUE,
	"name" TEXT NOT NULL,
	"password_hash" TEXT NOT NULL,
	"is_admin" BOOLEAN NOT NULL DEFAULT false,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "users_workspace_id_idx" ON "exagram"."users" ("workspace_id");

CREATE TABLE "exagram"."sessions" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"token_hash" TEXT NOT NULL UNIQUE,
	"expires_at" TIMESTAMPTZ NOT NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "sessions_user_id_idx" ON "exagram"."sessions" ("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "exagram"."sessions" ("expires_at");

COMMIT;
