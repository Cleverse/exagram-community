BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."memberships" IN EXCLUSIVE MODE;
LOCK TABLE "exagram"."users", "exagram"."sessions", "exagram"."connections" IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER "memberships_legacy_mirror" ON "exagram"."memberships";
DROP FUNCTION "exagram".memberships_legacy_mirror();
DROP FUNCTION "exagram".copy_legacy_home(UUID);
DROP FUNCTION "exagram".legacy_home(UUID);
DROP TRIGGER "users_sync_unclaimed" ON "exagram"."users";
DROP FUNCTION "exagram".users_sync_unclaimed();
DROP TRIGGER "users_legacy_mirror" ON "exagram"."users";
DROP FUNCTION "exagram".users_legacy_mirror();
DROP TRIGGER "sessions_default_workspace" ON "exagram"."sessions";
DROP TRIGGER "connections_default_workspace" ON "exagram"."connections";
DROP FUNCTION "exagram".default_workspace_from_user();
DROP FUNCTION "exagram".invite_usable(UUID, TEXT, TEXT);

ALTER TABLE "exagram"."users"
	DROP COLUMN "workspace_id",
	DROP COLUMN "is_admin",
	DROP COLUMN "invited_at",
	DROP COLUMN "removed_at",
	DROP COLUMN "last_seen_at",
	DROP COLUMN "joined_at";

COMMIT;
