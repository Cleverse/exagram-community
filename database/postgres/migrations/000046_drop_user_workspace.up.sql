BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."memberships" IN EXCLUSIVE MODE;
LOCK TABLE "exagram"."users", "exagram"."sessions", "exagram"."connections" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
	stuck BIGINT;
BEGIN
	SELECT count(*) INTO stuck FROM "exagram"."users" u
	WHERE u.invited_at IS NOT NULL AND "exagram".has_live_membership(u.id);
	IF stuck > 0 THEN
		RAISE EXCEPTION '000046 up: % accounts are live members but still marked invited; clear their users.invited_at first', stuck;
	END IF;
END
$$;

ALTER TABLE "exagram"."users" ADD COLUMN "unclaimed" BOOLEAN NOT NULL DEFAULT false;
UPDATE "exagram"."users" SET "unclaimed" = true, "created_at" = "invited_at" WHERE "invited_at" IS NOT NULL;
ALTER TABLE "exagram"."users" ALTER COLUMN "workspace_id" DROP NOT NULL;

CREATE FUNCTION "exagram".users_sync_unclaimed() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.invited_at IS NOT NULL THEN
			NEW.unclaimed := true;
		ELSIF NEW.unclaimed THEN
			NEW.invited_at := NEW.created_at;
		END IF;
	ELSIF NEW.invited_at IS DISTINCT FROM OLD.invited_at THEN
		NEW.unclaimed := NEW.invited_at IS NOT NULL;
	ELSIF NEW.unclaimed IS DISTINCT FROM OLD.unclaimed THEN
		NEW.invited_at := CASE WHEN NEW.unclaimed THEN NEW.created_at END;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "users_sync_unclaimed" BEFORE INSERT OR UPDATE OF invited_at, unclaimed ON "exagram"."users"
	FOR EACH ROW EXECUTE FUNCTION "exagram".users_sync_unclaimed();

CREATE FUNCTION "exagram".legacy_home(p_user UUID) RETURNS SETOF "exagram"."memberships"
LANGUAGE sql STABLE AS $$
	SELECT m.* FROM "exagram"."memberships" m
	WHERE m.user_id = p_user
	ORDER BY (m.kind = 'team' AND m.removed_at IS NULL AND m.invited_at IS NULL) DESC,
		(m.kind = 'personal') DESC, (m.invited_at IS NULL) DESC, m.created_at, m.workspace_id
	LIMIT 1
$$;

CREATE FUNCTION "exagram".copy_legacy_home(p_user UUID) RETURNS VOID
LANGUAGE sql AS $$
	UPDATE "exagram"."users" u SET
		workspace_id = h.workspace_id, is_admin = h.role = 'admin', joined_at = h.joined_at,
		last_seen_at = h.last_seen_at, removed_at = h.removed_at
	FROM "exagram".legacy_home(p_user) h
	WHERE u.id = p_user
	  AND (u.workspace_id, u.is_admin, u.joined_at, u.last_seen_at, u.removed_at)
		IS DISTINCT FROM (h.workspace_id, h.role = 'admin', h.joined_at, h.last_seen_at, h.removed_at)
$$;

SELECT "exagram".copy_legacy_home(u.id) FROM "exagram"."users" u;

CREATE FUNCTION "exagram".memberships_legacy_mirror() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM "exagram".copy_legacy_home(CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END);
	RETURN NULL;
END;
$$;

CREATE TRIGGER "memberships_legacy_mirror" AFTER INSERT OR UPDATE OR DELETE ON "exagram"."memberships"
	FOR EACH ROW EXECUTE FUNCTION "exagram".memberships_legacy_mirror();

CREATE OR REPLACE FUNCTION "exagram".bare_account(p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		WHERE u.id = p_user AND u.unclaimed
		  AND NOT EXISTS (SELECT 1 FROM "exagram"."memberships" m WHERE m.user_id = u.id)
	)
$$;

CREATE OR REPLACE FUNCTION "exagram".lock_unclaimed_account(p_user UUID) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM 1 FROM "exagram"."memberships" m WHERE m.user_id = p_user ORDER BY m.workspace_id FOR NO KEY UPDATE;
	PERFORM pg_advisory_xact_lock(hashtext('bare:' || lower(u.email::TEXT))) FROM "exagram"."users" u WHERE u.id = p_user;
	RETURN EXISTS (
		SELECT 1 FROM "exagram"."users" u WHERE u.id = p_user AND u.unclaimed FOR NO KEY UPDATE
	);
END;
$$;

CREATE OR REPLACE FUNCTION "exagram".claim_unclaimed_account(p_user UUID, p_name TEXT, p_password_hash TEXT) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
	claimed UUID;
BEGIN
	IF NOT "exagram".lock_unclaimed_account(p_user) THEN
		RETURN NULL;
	END IF;
	UPDATE "exagram"."users" u
	SET unclaimed = false, created_at = now(), password_hash = p_password_hash,
		name = CASE WHEN u.name = u.email::TEXT AND p_name IS NOT NULL THEN p_name ELSE u.name END
	WHERE u.id = p_user AND u.unclaimed AND u.password_hash = '!exagram:google-claim-required:v1!'
	RETURNING u.id INTO claimed;
	IF claimed IS NULL THEN
		RETURN NULL;
	END IF;
	DELETE FROM "exagram"."memberships" m
	WHERE m.user_id = p_user AND m.invited_at IS NOT NULL AND m.removed_at IS NULL;
	PERFORM "exagram".ensure_personal_workspace(p_user);
	RETURN claimed;
END;
$$;

CREATE FUNCTION "exagram".home_workspace(p_user UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
	SELECT m.workspace_id FROM "exagram"."memberships" m
	WHERE m.user_id = p_user
	ORDER BY "exagram".live_member(m.user_id, m.workspace_id) DESC, (m.kind = 'team') DESC, m.created_at DESC,
		m.workspace_id
	LIMIT 1
$$;

CREATE OR REPLACE FUNCTION "exagram".ledger_call_workspace(p_kind TEXT, p_id UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
	SELECT CASE p_kind
		WHEN 'connection' THEN (SELECT c.workspace_id FROM "exagram"."connections" c WHERE c.id = p_id)
		WHEN 'link' THEN (
			SELECT a.workspace_id FROM "exagram"."links" l JOIN "exagram"."artifacts" a ON a.id = l.artifact_id
			WHERE l.id = p_id
		)
		WHEN 'anonymous' THEN (SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = p_id)
		ELSE "exagram".home_workspace(p_id)
	END
$$;

CREATE VIEW "exagram"."reaching_grants" AS SELECT g.* FROM "exagram"."grants" g WHERE NOT g.dormant;

CREATE OR REPLACE FUNCTION exagram.reach_rows(p_user_id uuid)
 RETURNS TABLE(artifact_id uuid, revision_id uuid, access text, src_rank integer, pinned boolean)
 LANGUAGE sql
 STABLE
AS $function$
	-- Rule 1: everything the user owns, directly or through a project they own.
	WITH owned AS (
		SELECT
			a.id AS artifact_id,
			a.current_revision_id AS revision_id,
			'owner'::TEXT AS access,
			0 AS src_rank,
			false AS pinned
		FROM "exagram"."artifacts" a
		WHERE a.deleted_at IS NULL
		  AND "exagram".artifact_owner(a.id) = p_user_id
	),
	-- Rule 2a: a grant on the artifact itself.
	granted_direct AS (
		SELECT
			a.id AS artifact_id,
			COALESCE(g.pinned_revision_id, a.current_revision_id) AS revision_id,
			g.role AS access,
			1 AS src_rank,
			g.pinned_revision_id IS NOT NULL AS pinned
		FROM "exagram"."reaching_grants" g
		JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		WHERE g.grantee_id = p_user_id AND g.artifact_id IS NOT NULL AND a.deleted_at IS NULL
	),
	-- Rule 2b: a grant on a project covers the project and its one level of children.
	granted_project AS (
		SELECT
			a.id AS artifact_id,
			COALESCE(g.pinned_revision_id, a.current_revision_id) AS revision_id,
			g.role AS access,
			2 AS src_rank,
			g.pinned_revision_id IS NOT NULL AS pinned
		FROM "exagram"."reaching_grants" g
		JOIN "exagram"."projects" p ON p.id = g.project_id
		JOIN "exagram"."artifacts" a
			ON a.project_id = p.id
			OR a.project_id IN (
				SELECT cp.id FROM "exagram"."projects" cp WHERE cp.parent_project_id = p.id
			)
		WHERE g.grantee_id = p_user_id AND g.project_id IS NOT NULL AND a.deleted_at IS NULL
	)
	SELECT * FROM owned
	UNION ALL
	SELECT * FROM granted_direct
	UNION ALL
	SELECT * FROM granted_project
$function$;

CREATE OR REPLACE FUNCTION exagram.reaches_artifact(p_user_id uuid, p_artifact_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
	SELECT EXISTS (
		SELECT 1
		FROM "exagram"."artifacts" a
		LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
		WHERE a.id = p_artifact_id
		  AND a.deleted_at IS NULL
		  AND (
			"exagram".artifact_owner(a.id) = p_user_id
			OR EXISTS (
				SELECT 1 FROM "exagram"."reaching_grants" g
				WHERE g.grantee_id = p_user_id
				  AND (g.artifact_id = a.id OR g.project_id IN (p.id, p.parent_project_id))
			)
		  )
	)
$function$;

CREATE OR REPLACE FUNCTION exagram.user_project_role(p_user_id uuid, p_project_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
	SELECT CASE
		WHEN p.owner_id = p_user_id THEN 'owner'::TEXT
		ELSE (
			SELECT g.role
			FROM "exagram"."reaching_grants" g
			WHERE g.grantee_id = p_user_id
			  AND g.project_id IN (p.id, p.parent_project_id)
			ORDER BY CASE g.role WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END
			LIMIT 1
		)
	END
	FROM "exagram"."projects" p
	WHERE p.id = p_project_id
$function$;

CREATE OR REPLACE FUNCTION exagram.reach_set(p_artifact_id uuid, p_owner_id uuid, p_project_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
AS $function$
	SELECT array_agg(DISTINCT x.user_id ORDER BY x.user_id)
	FROM (
		SELECT COALESCE(p.owner_id, p_owner_id) AS user_id
		FROM (SELECT 1) one
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		UNION
		SELECT g.grantee_id
		FROM "exagram"."reaching_grants" g
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		WHERE (g.artifact_id = p_artifact_id OR g.project_id IN (p.id, p.parent_project_id))
	) x
$function$;

COMMIT;
