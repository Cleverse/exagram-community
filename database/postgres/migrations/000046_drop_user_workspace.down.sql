BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."memberships" IN EXCLUSIVE MODE;
LOCK TABLE "exagram"."users", "exagram"."sessions", "exagram"."connections" IN ACCESS EXCLUSIVE MODE;

UPDATE "exagram"."users" u SET workspace_id = (
	SELECT COALESCE(a.workspace_id, p.workspace_id)
	FROM "exagram"."grants" g
	LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
	WHERE g.grantee_id = u.id
	ORDER BY g.created_at, g.id
	LIMIT 1
)
WHERE u.workspace_id IS NULL;

DO $$
DECLARE
	swept BIGINT;
	homeless BIGINT;
BEGIN
	WITH gone AS (
		DELETE FROM "exagram"."users" u
		WHERE u.workspace_id IS NULL AND u.unclaimed
		  AND NOT EXISTS (SELECT 1 FROM "exagram"."memberships" m WHERE m.user_id = u.id)
		  AND NOT EXISTS (SELECT 1 FROM "exagram"."grants" g WHERE g.grantee_id = u.id)
		  AND NOT EXISTS (SELECT 1 FROM "exagram"."user_identities" i WHERE i.user_id = u.id)
		RETURNING 1
	)
	SELECT count(*) INTO swept FROM gone;
	IF swept > 0 THEN
		RAISE NOTICE '000046 down: deleted % unclaimed accounts that hold no membership, no Grant and no sign-in', swept;
	END IF;
	SELECT count(*) INTO homeless FROM "exagram"."users" WHERE workspace_id IS NULL;
	IF homeless > 0 THEN
		RAISE EXCEPTION '000046 down: % accounts hold no membership and no Grant, so no Workspace can be rebuilt for them; delete them first', homeless;
	END IF;
END
$$;

ALTER TABLE "exagram"."users" ALTER COLUMN "workspace_id" SET NOT NULL;

DROP TRIGGER "memberships_legacy_mirror" ON "exagram"."memberships";
DROP FUNCTION "exagram".memberships_legacy_mirror();
DROP FUNCTION "exagram".copy_legacy_home(UUID);
DROP FUNCTION "exagram".legacy_home(UUID);
DROP TRIGGER "users_sync_unclaimed" ON "exagram"."users";
DROP FUNCTION "exagram".users_sync_unclaimed();

CREATE OR REPLACE FUNCTION "exagram".bare_account(p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		WHERE u.id = p_user AND u.invited_at IS NOT NULL
		  AND NOT EXISTS (SELECT 1 FROM "exagram"."memberships" m WHERE m.user_id = u.id)
	)
$$;

CREATE OR REPLACE FUNCTION "exagram".lock_unclaimed_account(p_user UUID) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM 1 FROM "exagram"."memberships" m WHERE m.user_id = p_user ORDER BY m.workspace_id FOR NO KEY UPDATE;
	PERFORM pg_advisory_xact_lock(hashtext('bare:' || lower(u.email::TEXT))) FROM "exagram"."users" u WHERE u.id = p_user;
	RETURN EXISTS (
		SELECT 1 FROM "exagram"."users" u WHERE u.id = p_user AND u.invited_at IS NOT NULL FOR NO KEY UPDATE
	);
END;
$$;

CREATE OR REPLACE FUNCTION "exagram".claim_unclaimed_account(p_user UUID, p_name TEXT, p_password_hash TEXT) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
	claimed UUID;
	personal UUID;
BEGIN
	IF NOT "exagram".lock_unclaimed_account(p_user) THEN
		RETURN NULL;
	END IF;
	-- Before the users UPDATE, whose invited_at a trigger copies onto these memberships and would make live.
	-- A claim that then matches nothing returns null and every caller aborts its transaction.
	DELETE FROM "exagram"."memberships" m
	WHERE m.user_id = p_user AND m.invited_at IS NOT NULL AND m.removed_at IS NULL;
	UPDATE "exagram"."users" u
	SET invited_at = NULL, joined_at = now(), created_at = now(), password_hash = p_password_hash,
		name = CASE WHEN u.name = u.email::TEXT AND p_name IS NOT NULL THEN p_name ELSE u.name END
	WHERE u.id = p_user AND u.invited_at IS NOT NULL AND u.password_hash = '!exagram:google-claim-required:v1!'
	RETURNING u.id INTO claimed;
	IF claimed IS NULL THEN
		RETURN NULL;
	END IF;
	personal := "exagram".ensure_personal_workspace(p_user);
	UPDATE "exagram"."users" SET workspace_id = personal, is_admin = true WHERE id = p_user;
	RETURN claimed;
END;
$$;

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
		FROM "exagram"."grants" g
		JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		WHERE g.grantee_id = p_user_id AND g.artifact_id IS NOT NULL AND NOT g.dormant AND a.deleted_at IS NULL
	),
	-- Rule 2b: a grant on a project covers the project and its one level of children.
	granted_project AS (
		SELECT
			a.id AS artifact_id,
			COALESCE(g.pinned_revision_id, a.current_revision_id) AS revision_id,
			g.role AS access,
			2 AS src_rank,
			g.pinned_revision_id IS NOT NULL AS pinned
		FROM "exagram"."grants" g
		JOIN "exagram"."projects" p ON p.id = g.project_id
		JOIN "exagram"."artifacts" a
			ON a.project_id = p.id
			OR a.project_id IN (
				SELECT cp.id FROM "exagram"."projects" cp WHERE cp.parent_project_id = p.id
			)
		WHERE g.grantee_id = p_user_id AND g.project_id IS NOT NULL AND NOT g.dormant AND a.deleted_at IS NULL
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
				SELECT 1 FROM "exagram"."grants" g
				WHERE g.grantee_id = p_user_id AND NOT g.dormant
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
			FROM "exagram"."grants" g
			WHERE g.grantee_id = p_user_id AND NOT g.dormant
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
		FROM "exagram"."grants" g
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		WHERE NOT g.dormant AND (g.artifact_id = p_artifact_id OR g.project_id IN (p.id, p.parent_project_id))
	) x
$function$;

DROP VIEW "exagram"."reaching_grants";

DROP FUNCTION "exagram".home_workspace(UUID);
ALTER TABLE "exagram"."users" DROP COLUMN "unclaimed";

COMMIT;
