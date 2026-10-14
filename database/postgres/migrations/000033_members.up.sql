BEGIN;

ALTER TABLE "exagram"."workspaces"
	ADD COLUMN "owner_id" UUID REFERENCES "exagram"."users"("id") ON DELETE SET NULL;

ALTER TABLE "exagram"."users"
	ADD COLUMN "removed_at" TIMESTAMPTZ,
	ADD COLUMN "last_seen_at" TIMESTAMPTZ,
	ADD COLUMN "joined_at" TIMESTAMPTZ;

UPDATE "exagram"."workspaces" w
SET "owner_id" = (
	SELECT u.id FROM "exagram"."users" u
	WHERE u.workspace_id = w.id AND u.is_admin
	ORDER BY u.created_at, u.id
	LIMIT 1
);

UPDATE "exagram"."users" u
SET "last_seen_at" = s.latest
FROM (
	SELECT user_id, max(created_at) AS latest FROM "exagram"."sessions" GROUP BY user_id
) s
WHERE s.user_id = u.id;

CREATE FUNCTION "exagram"."invite_usable"(inviter UUID, invite_role TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		WHERE u.id = inviter AND u.removed_at IS NULL AND (invite_role <> 'admin' OR u.is_admin)
	)
$$;

COMMIT;
