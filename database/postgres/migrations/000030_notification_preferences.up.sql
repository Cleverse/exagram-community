BEGIN;

-- Notification Preferences: which of the four kinds a member wants. One row per member who
-- saved; no row means every kind is on.
CREATE TABLE "exagram"."notification_preferences" (
	"user_id" UUID PRIMARY KEY REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"access_requests" BOOLEAN NOT NULL DEFAULT true,
	"pending_revisions" BOOLEAN NOT NULL DEFAULT true,
	"grants" BOOLEAN NOT NULL DEFAULT true,
	"comments" BOOLEAN NOT NULL DEFAULT true,
	"updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The feed asks whether any comment is new before it works out which Artifacts a member reaches, so
-- that check must not scan every comment. Grants to a member use "grants_grantee_id_idx".
CREATE INDEX "comments_created_at_idx" ON "exagram"."comments" ("created_at");

COMMIT;
