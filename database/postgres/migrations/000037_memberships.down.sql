BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."workspaces", "exagram"."users", "exagram"."memberships", "exagram"."sessions",
	"exagram"."connections", "exagram"."ledger_calls", "exagram"."projects", "exagram"."artifacts"
	IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "exagram"."artifacts" DROP CONSTRAINT "artifacts_project_same_workspace_fk";
ALTER TABLE "exagram"."projects" DROP CONSTRAINT "projects_parent_same_workspace_fk";
ALTER TABLE "exagram"."projects" DROP CONSTRAINT "projects_id_workspace_key";

DO $$
DECLARE
	clashes BIGINT;
BEGIN
	SELECT count(*) INTO clashes FROM (
		SELECT 1 FROM "exagram"."projects"
		GROUP BY owner_id, COALESCE(parent_project_id, '00000000-0000-0000-0000-000000000000'::UUID), name
		HAVING count(*) > 1
	) c;
	IF clashes > 0 THEN
		RAISE EXCEPTION '000037 down: % folder names repeat for one owner across Workspaces; rename them first', clashes;
	END IF;
END
$$;

DROP INDEX "exagram"."projects_owner_parent_name_key";
CREATE UNIQUE INDEX "projects_owner_parent_name_key"
	ON "exagram"."projects" (
		"owner_id",
		COALESCE("parent_project_id", '00000000-0000-0000-0000-000000000000'::UUID),
		"name"
	);

DROP TRIGGER "connections_default_workspace" ON "exagram"."connections";
DROP TRIGGER "sessions_default_workspace" ON "exagram"."sessions";
DROP FUNCTION "exagram".default_workspace_from_user();

ALTER TABLE "exagram"."ledger_calls" DROP COLUMN "workspace_id";
ALTER TABLE "exagram"."connections" DROP COLUMN "workspace_id";
ALTER TABLE "exagram"."sessions" DROP COLUMN "workspace_id";

DROP TRIGGER "users_sync_membership" ON "exagram"."users";
DROP FUNCTION "exagram".users_sync_membership();
DROP TABLE "exagram"."memberships";

ALTER TABLE "exagram"."workspaces"
	DROP CONSTRAINT "workspaces_id_kind_key",
	DROP COLUMN "kind";

COMMIT;
