BEGIN;

DROP FUNCTION IF EXISTS "exagram"."invite_usable"(UUID, TEXT);

ALTER TABLE "exagram"."users"
	DROP COLUMN IF EXISTS "joined_at",
	DROP COLUMN IF EXISTS "last_seen_at",
	DROP COLUMN IF EXISTS "removed_at";

ALTER TABLE "exagram"."workspaces" DROP COLUMN IF EXISTS "owner_id";

COMMIT;
