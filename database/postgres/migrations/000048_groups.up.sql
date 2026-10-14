BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."workspaces", "exagram"."users", "exagram"."memberships" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "exagram"."groups" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id") ON DELETE CASCADE,
	"name" TEXT NOT NULL CHECK (length(btrim("name")) > 0),
	"created_by" UUID REFERENCES "exagram"."users"("id") ON DELETE SET NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "groups_workspace_name_key" ON "exagram"."groups" ("workspace_id", lower("name"));

CREATE TABLE "exagram"."group_members" (
	"group_id" UUID NOT NULL REFERENCES "exagram"."groups"("id") ON DELETE CASCADE,
	"user_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	PRIMARY KEY ("group_id", "user_id")
);

CREATE INDEX "group_members_user_id_idx" ON "exagram"."group_members" ("user_id");

-- Not 000040's refuse_personal_feature: the tests that roll 000040 back alone cannot drop it while a trigger uses it.
CREATE FUNCTION "exagram".personal_no_groups() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF "exagram".is_personal_locked(NEW.workspace_id) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Groups.' USING ERRCODE = 'EXP01';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "personal_no_groups" BEFORE INSERT OR UPDATE OF workspace_id ON "exagram"."groups"
	FOR EACH ROW EXECUTE FUNCTION "exagram".personal_no_groups();

CREATE FUNCTION "exagram".personal_flip_guard_groups() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "exagram"."groups" g
		WHERE g.workspace_id IN (
			SELECT n.id FROM new_rows n JOIN old_rows o ON o.id = n.id WHERE n.kind = 'personal' AND o.kind <> 'personal'
		)
	) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Groups.'
			USING ERRCODE = 'EXP01', DETAIL = 'Clean the Workspace before it becomes Personal.';
	END IF;
	RETURN NULL;
END;
$$;

CREATE TRIGGER "personal_flip_guard_groups"
	AFTER UPDATE ON "exagram"."workspaces"
	REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
	FOR EACH STATEMENT EXECUTE FUNCTION "exagram".personal_flip_guard_groups();

CREATE FUNCTION "exagram".memberships_leave_groups() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	DELETE FROM "exagram"."group_members" gm
	USING "exagram"."groups" g
	WHERE g.id = gm.group_id AND g.workspace_id = NEW.workspace_id AND gm.user_id = NEW.user_id;
	RETURN NULL;
END;
$$;

CREATE TRIGGER "memberships_leave_groups"
	AFTER UPDATE OF removed_at, invited_at ON "exagram"."memberships"
	FOR EACH ROW WHEN (
		OLD.removed_at IS NULL AND OLD.invited_at IS NULL AND (NEW.removed_at IS NOT NULL OR NEW.invited_at IS NOT NULL)
	)
	EXECUTE FUNCTION "exagram".memberships_leave_groups();

COMMIT;
