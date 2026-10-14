BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."workspaces", "exagram"."users", "exagram"."memberships" IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER "memberships_leave_groups" ON "exagram"."memberships";
DROP FUNCTION "exagram".memberships_leave_groups();
DROP TRIGGER "personal_flip_guard_groups" ON "exagram"."workspaces";
DROP FUNCTION "exagram".personal_flip_guard_groups();
DROP TRIGGER "personal_no_groups" ON "exagram"."groups";
DROP FUNCTION "exagram".personal_no_groups();
DROP TABLE "exagram"."group_members";
DROP TABLE "exagram"."groups";

COMMIT;
