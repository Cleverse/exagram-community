BEGIN;

CREATE TABLE "exagram"."join_requests" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id") ON DELETE CASCADE,
	"email" public.CITEXT NOT NULL,
	"name" TEXT NOT NULL,
	"password_hash" TEXT,
	"google_subject" TEXT,
	"via" TEXT NOT NULL CHECK ("via" IN ('domain', 'member_invite')),
	"invited_by" UUID REFERENCES "exagram"."users"("id") ON DELETE SET NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"declined_at" TIMESTAMPTZ,
	UNIQUE ("workspace_id", "email"),
	CHECK ("declined_at" IS NOT NULL OR "password_hash" IS NOT NULL OR "google_subject" IS NOT NULL)
);

CREATE INDEX "join_requests_email_idx" ON "exagram"."join_requests" ("email");

CREATE OR REPLACE FUNCTION "exagram"."invite_usable"(inviter UUID, invite_role TEXT, invite_via TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		JOIN "exagram"."workspaces" w ON w.id = u.workspace_id
		WHERE u.id = inviter AND u.removed_at IS NULL
			AND CASE invite_via
				WHEN 'member_invite' THEN invite_role = 'member' AND w.member_invites
				ELSE invite_role <> 'admin' OR u.is_admin
			END
	)
$$;

COMMIT;
