BEGIN;

-- The oidc-provider Postgres adapter table.
CREATE TABLE "exagram"."oidc_payloads" (
	"id" TEXT NOT NULL,
	"type" TEXT NOT NULL,
	"payload" JSONB,
	"grant_id" TEXT,
	"user_code" TEXT,
	"uid" TEXT,
	"expires_at" TIMESTAMPTZ,
	"consumed_at" TIMESTAMPTZ,
	PRIMARY KEY ("id", "type")
);

CREATE INDEX "oidc_payloads_grant_id_idx" ON "exagram"."oidc_payloads" ("grant_id");
CREATE INDEX "oidc_payloads_user_code_idx" ON "exagram"."oidc_payloads" ("user_code");
CREATE INDEX "oidc_payloads_uid_idx" ON "exagram"."oidc_payloads" ("uid");
CREATE INDEX "oidc_payloads_expires_at_idx" ON "exagram"."oidc_payloads" ("expires_at");

CREATE TABLE "exagram"."connections" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"oidc_client_id" TEXT NOT NULL,
	"oidc_grant_id" TEXT,
	"name" TEXT NOT NULL,
	"scopes" TEXT[] NOT NULL CHECK ("scopes" <@ ARRAY['read','write','manage']::TEXT[]),
	-- Empty means the Connection sees nothing. It never means everything.
	"project_ids" UUID[] NOT NULL,
	"revoked_at" TIMESTAMPTZ,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "connections_user_id_idx" ON "exagram"."connections" ("user_id");
CREATE INDEX "connections_oidc_grant_id_idx" ON "exagram"."connections" ("oidc_grant_id");

ALTER TABLE "exagram"."revisions"
	ADD CONSTRAINT "revisions_author_connection_fk"
	FOREIGN KEY ("author_connection_id") REFERENCES "exagram"."connections"("id");

CREATE INDEX "revisions_author_connection_id_idx"
	ON "exagram"."revisions" ("author_connection_id") WHERE "author_connection_id" IS NOT NULL;

COMMIT;
