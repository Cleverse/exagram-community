BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "exagram"."workspaces" ADD COLUMN IF NOT EXISTS "notification_email_resumed_at" TIMESTAMPTZ;
COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."projects", "exagram"."sessions", "exagram"."ledger_calls" IN SHARE ROW EXCLUSIVE MODE;

-- A Project's own Grants are released by projects_release_grants below while its row still exists, because a cascade
-- deletes the Grants after the Project and grants_notify then has no Workspace to address.
CREATE OR REPLACE FUNCTION "exagram".grants_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_row          "exagram"."grants"%ROWTYPE;
  v_workspace_id uuid;
  v_project_id   uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  IF v_row.artifact_id IS NOT NULL THEN
    SELECT a.workspace_id, a.project_id INTO v_workspace_id, v_project_id
      FROM "exagram"."artifacts" a WHERE a.id = v_row.artifact_id;
  ELSE
    v_project_id := v_row.project_id;
    SELECT p.workspace_id INTO v_workspace_id FROM "exagram"."projects" p WHERE p.id = v_row.project_id;
  END IF;

  PERFORM "exagram".notify_change(v_workspace_id, v_row.artifact_id, v_project_id, 'reach', ARRAY[v_row.grantee_id]);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION "exagram".projects_release_grants() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "exagram"."grants" WHERE project_id = OLD.id;
  RETURN OLD;
END $$;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_trigger WHERE tgname = 'projects_release_grants' AND tgrelid = '"exagram"."projects"'::regclass
	) THEN
		CREATE TRIGGER "projects_release_grants" BEFORE DELETE ON "exagram"."projects" FOR EACH ROW EXECUTE FUNCTION "exagram".projects_release_grants();
	END IF;
END $$;

CREATE OR REPLACE FUNCTION "exagram".sessions_notify_switch() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('exagram_changes', json_build_object('t', 'sessionSwitched', 's', NEW.id, 'w', NEW.workspace_id)::text);
  RETURN NULL;
END $$;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_trigger WHERE tgname = 'sessions_notify_switch' AND tgrelid = '"exagram"."sessions"'::regclass
	) THEN
		CREATE TRIGGER "sessions_notify_switch" AFTER UPDATE OF workspace_id ON "exagram"."sessions" FOR EACH ROW WHEN (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id) EXECUTE FUNCTION "exagram".sessions_notify_switch();
	END IF;
END $$;

CREATE OR REPLACE FUNCTION "exagram".ledger_call_workspace(p_kind TEXT, p_id UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
	SELECT CASE p_kind
		WHEN 'connection' THEN (
			SELECT COALESCE(c.workspace_id, u.workspace_id)
			FROM "exagram"."connections" c JOIN "exagram"."users" u ON u.id = c.user_id
			WHERE c.id = p_id
		)
		WHEN 'link' THEN (
			SELECT a.workspace_id FROM "exagram"."links" l JOIN "exagram"."artifacts" a ON a.id = l.artifact_id
			WHERE l.id = p_id
		)
		WHEN 'anonymous' THEN (SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = p_id)
		ELSE (SELECT u.workspace_id FROM "exagram"."users" u WHERE u.id = p_id)
	END
$$;

CREATE OR REPLACE FUNCTION "exagram".ledger_calls_default_workspace() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.workspace_id := "exagram".ledger_call_workspace(NEW.principal_kind, NEW.principal_id);
  RETURN NEW;
END $$;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_trigger WHERE tgname = 'ledger_calls_default_workspace' AND tgrelid = '"exagram"."ledger_calls"'::regclass
	) THEN
		CREATE TRIGGER "ledger_calls_default_workspace" BEFORE INSERT ON "exagram"."ledger_calls" FOR EACH ROW WHEN (NEW.workspace_id IS NULL) EXECUTE FUNCTION "exagram".ledger_calls_default_workspace();
	END IF;
END $$;

COMMIT;

-- Old calls are stamped in sixteen transactions of their own, with no table lock.
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '0';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '1';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '2';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '3';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '4';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '5';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '6';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '7';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '8';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = '9';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = 'a';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = 'b';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = 'c';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = 'd';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = 'e';
COMMIT;
BEGIN;
UPDATE "exagram"."ledger_calls" c
SET workspace_id = COALESCE(
	CASE WHEN c.principal_kind IN ('user', 'operator') THEN (
		SELECT m.workspace_id FROM "exagram"."memberships" m
		WHERE m.user_id = c.principal_id AND m.kind = 'team' AND m.invited_at IS NULL
		  AND COALESCE(m.joined_at, m.created_at) <= c.started_at
		  AND (m.removed_at IS NULL OR m.removed_at > c.started_at)
		ORDER BY COALESCE(m.joined_at, m.created_at) DESC
		LIMIT 1
	) END,
	"exagram".ledger_call_workspace(c.principal_kind, c.principal_id)
)
WHERE c.workspace_id IS NULL AND left(c.id::text, 1) = 'f';
COMMIT;
