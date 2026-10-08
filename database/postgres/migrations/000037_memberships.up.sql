BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."workspaces", "exagram"."users", "exagram"."sessions", "exagram"."connections",
	"exagram"."ledger_calls", "exagram"."projects", "exagram"."artifacts" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "exagram"."workspaces"
	ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'team' CHECK ("kind" IN ('personal', 'team')),
	ADD CONSTRAINT "workspaces_id_kind_key" UNIQUE ("id", "kind");

CREATE TABLE "exagram"."memberships" (
	"user_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"workspace_id" UUID NOT NULL,
	"kind" TEXT NOT NULL,
	"role" TEXT NOT NULL DEFAULT 'member' CHECK ("role" IN ('admin', 'member')),
	"joined_at" TIMESTAMPTZ,
	"last_seen_at" TIMESTAMPTZ,
	"removed_at" TIMESTAMPTZ,
	"invited_at" TIMESTAMPTZ,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY ("user_id", "workspace_id"),
	FOREIGN KEY ("workspace_id", "kind") REFERENCES "exagram"."workspaces"("id", "kind") ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "memberships_one_personal_per_user"
	ON "exagram"."memberships" ("user_id") WHERE "kind" = 'personal';
CREATE UNIQUE INDEX "memberships_one_user_per_personal"
	ON "exagram"."memberships" ("workspace_id") WHERE "kind" = 'personal';
CREATE UNIQUE INDEX "memberships_one_live_team_per_user"
	ON "exagram"."memberships" ("user_id") WHERE "kind" = 'team' AND "removed_at" IS NULL;
CREATE INDEX "memberships_live_workspace_idx"
	ON "exagram"."memberships" ("workspace_id") WHERE "removed_at" IS NULL;

INSERT INTO "exagram"."memberships"
	(user_id, workspace_id, kind, role, joined_at, last_seen_at, removed_at, invited_at, created_at)
SELECT u.id, u.workspace_id, w.kind, CASE WHEN u.is_admin THEN 'admin' ELSE 'member' END,
	u.joined_at, u.last_seen_at, u.removed_at, u.invited_at, u.created_at
FROM "exagram"."users" u
JOIN "exagram"."workspaces" w ON w.id = u.workspace_id;

-- Copies only what this users write changed, so a direct membership write is never undone.
CREATE FUNCTION "exagram".users_sync_membership() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	moved BOOLEAN := TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id;
BEGIN
	IF moved THEN
		UPDATE "exagram"."memberships" SET removed_at = now()
		WHERE user_id = NEW.id AND workspace_id = OLD.workspace_id AND kind = 'team' AND removed_at IS NULL;
	END IF;

	IF TG_OP = 'INSERT' OR moved OR NOT EXISTS (
		SELECT 1 FROM "exagram"."memberships" m
		WHERE m.user_id = NEW.id AND m.workspace_id = NEW.workspace_id AND m.kind = 'team'
	) THEN
		INSERT INTO "exagram"."memberships"
			(user_id, workspace_id, kind, role, joined_at, last_seen_at, removed_at, invited_at, created_at)
		SELECT NEW.id, NEW.workspace_id, 'team', CASE WHEN NEW.is_admin THEN 'admin' ELSE 'member' END,
			NEW.joined_at, NEW.last_seen_at, NEW.removed_at, NEW.invited_at, NEW.created_at
		FROM "exagram"."workspaces" w
		WHERE w.id = NEW.workspace_id AND w.kind = 'team'
		  AND (NEW.removed_at IS NOT NULL OR NOT EXISTS (
			SELECT 1 FROM "exagram"."memberships" x
			WHERE x.user_id = NEW.id AND x.kind = 'team' AND x.removed_at IS NULL
		  ))
		ON CONFLICT (user_id, workspace_id) DO NOTHING;
		RETURN NULL;
	END IF;

	UPDATE "exagram"."memberships" m SET
		role = CASE WHEN OLD.is_admin IS DISTINCT FROM NEW.is_admin
			THEN CASE WHEN NEW.is_admin THEN 'admin' ELSE 'member' END ELSE m.role END,
		joined_at = CASE WHEN OLD.joined_at IS DISTINCT FROM NEW.joined_at THEN NEW.joined_at ELSE m.joined_at END,
		last_seen_at = CASE WHEN OLD.last_seen_at IS DISTINCT FROM NEW.last_seen_at
			THEN NEW.last_seen_at ELSE m.last_seen_at END,
		removed_at = CASE WHEN OLD.removed_at IS DISTINCT FROM NEW.removed_at THEN NEW.removed_at ELSE m.removed_at END,
		invited_at = CASE WHEN OLD.invited_at IS DISTINCT FROM NEW.invited_at THEN NEW.invited_at ELSE m.invited_at END
	WHERE m.user_id = NEW.id AND m.workspace_id = NEW.workspace_id AND m.kind = 'team'
	  AND (OLD.is_admin, OLD.joined_at, OLD.last_seen_at, OLD.removed_at, OLD.invited_at)
		IS DISTINCT FROM (NEW.is_admin, NEW.joined_at, NEW.last_seen_at, NEW.removed_at, NEW.invited_at);
	RETURN NULL;
END;
$$;

CREATE TRIGGER "users_sync_membership"
	AFTER INSERT OR UPDATE OF workspace_id, is_admin, joined_at, last_seen_at, removed_at, invited_at
	ON "exagram"."users"
	FOR EACH ROW EXECUTE FUNCTION "exagram".users_sync_membership();

-- API pods older than this migration insert sessions and Connections without a Workspace.
CREATE FUNCTION "exagram".default_workspace_from_user() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.workspace_id IS NULL THEN
		SELECT u.workspace_id INTO NEW.workspace_id FROM "exagram"."users" u WHERE u.id = NEW.user_id;
	END IF;
	RETURN NEW;
END;
$$;

ALTER TABLE "exagram"."sessions"
	ADD COLUMN "workspace_id" UUID REFERENCES "exagram"."workspaces"("id");
UPDATE "exagram"."sessions" s SET workspace_id = u.workspace_id
FROM "exagram"."users" u WHERE u.id = s.user_id;
CREATE TRIGGER "sessions_default_workspace" BEFORE INSERT ON "exagram"."sessions"
	FOR EACH ROW EXECUTE FUNCTION "exagram".default_workspace_from_user();

ALTER TABLE "exagram"."connections"
	ADD COLUMN "workspace_id" UUID REFERENCES "exagram"."workspaces"("id");
UPDATE "exagram"."connections" c SET workspace_id = u.workspace_id
FROM "exagram"."users" u WHERE u.id = c.user_id;
CREATE TRIGGER "connections_default_workspace" BEFORE INSERT ON "exagram"."connections"
	FOR EACH ROW EXECUTE FUNCTION "exagram".default_workspace_from_user();

ALTER TABLE "exagram"."ledger_calls" ADD COLUMN "workspace_id" UUID;

DROP INDEX "exagram"."projects_owner_parent_name_key";
CREATE UNIQUE INDEX "projects_owner_parent_name_key"
	ON "exagram"."projects" (
		"owner_id",
		"workspace_id",
		COALESCE("parent_project_id", '00000000-0000-0000-0000-000000000000'::UUID),
		"name"
	);

DO $$
DECLARE
	stray_subfolders BIGINT;
	stray_artifacts BIGINT;
BEGIN
	SELECT count(*) INTO stray_subfolders
	FROM "exagram"."projects" c
	JOIN "exagram"."projects" p ON p.id = c.parent_project_id
	WHERE c.workspace_id <> p.workspace_id;

	SELECT count(*) INTO stray_artifacts
	FROM "exagram"."artifacts" a
	JOIN "exagram"."projects" p ON p.id = a.project_id
	WHERE a.workspace_id <> p.workspace_id;

	IF stray_subfolders > 0 OR stray_artifacts > 0 THEN
		RAISE EXCEPTION '000037: % subfolders and % artifacts sit in a folder of another Workspace; fix them before migrating',
			stray_subfolders, stray_artifacts;
	END IF;
END
$$;

ALTER TABLE "exagram"."projects"
	ADD CONSTRAINT "projects_id_workspace_key" UNIQUE ("id", "workspace_id");

ALTER TABLE "exagram"."projects"
	ADD CONSTRAINT "projects_parent_same_workspace_fk"
	FOREIGN KEY ("parent_project_id", "workspace_id") REFERENCES "exagram"."projects"("id", "workspace_id");

ALTER TABLE "exagram"."artifacts"
	ADD CONSTRAINT "artifacts_project_same_workspace_fk"
	FOREIGN KEY ("project_id", "workspace_id") REFERENCES "exagram"."projects"("id", "workspace_id");

COMMIT;
