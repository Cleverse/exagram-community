BEGIN;

SET LOCAL lock_timeout = '5s';
-- Lock the view before its tables, the order a read of reaching_grants takes them; LOCK on a view also locks its
-- tables. ACCESS EXCLUSIVE because DROP TRIGGER needs it on group_members and groups.
LOCK TABLE "exagram"."reaching_grants", "exagram"."grants", "exagram"."group_members", "exagram"."groups"
	IN ACCESS EXCLUSIVE MODE;

DELETE FROM "exagram"."grants" WHERE "group_id" IS NOT NULL;

DROP TRIGGER "group_members_notify_delete" ON "exagram"."group_members";
DROP TRIGGER "group_members_notify_insert" ON "exagram"."group_members";
DROP TRIGGER "groups_notify_delete" ON "exagram"."groups";
DROP FUNCTION "exagram".group_grants_notify();

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
  IF v_row.dormant THEN
    RETURN NULL;
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

CREATE OR REPLACE FUNCTION "exagram".connection_can_write_artifact(p_connection_id UUID, p_artifact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT COALESCE((
		SELECT rr.access IN ('owner', 'edit', 'collaborate')
		FROM "exagram"."connections" c, "exagram".reach_rows(c.user_id) rr
		WHERE c.id = p_connection_id
		  AND c.revoked_at IS NULL
		  AND rr.artifact_id = p_artifact_id
		  AND EXISTS (
			SELECT 1 FROM "exagram"."artifacts" a
			WHERE a.id = p_artifact_id AND "exagram".connection_covers_workspace(c.id, a.workspace_id)
		  )
		ORDER BY rr.src_rank, rr.pinned DESC,
			CASE rr.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END
		LIMIT 1
	), false)
$$;

DROP TRIGGER "check_share_target" ON "exagram"."grants";

CREATE OR REPLACE FUNCTION "exagram".check_share_target() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	target_workspace uuid;
	target_email text;
	target_policy boolean;
BEGIN
	IF NEW.artifact_id IS NOT NULL THEN
		SELECT workspace_id, restricted_shares INTO target_workspace, target_policy
			FROM exagram.artifacts WHERE id = NEW.artifact_id;
	ELSE
		SELECT workspace_id, restricted_shares INTO target_workspace, target_policy
			FROM exagram.projects WHERE id = NEW.project_id;
	END IF;
	IF NOT target_policy OR NOT EXISTS (
		SELECT 1 FROM exagram.workspaces WHERE id = target_workspace AND restricted_shares
	) THEN
		RETURN NEW;
	END IF;
	SELECT lower(btrim(email::text)) INTO target_email
		FROM exagram.users WHERE id = NEW.grantee_id;
	IF target_email IS NULL OR (
		NEW.shared_with_email IS NOT NULL AND lower(btrim(NEW.shared_with_email)) <> target_email
	) THEN
		RAISE EXCEPTION 'Restricted Shares grant email does not match grantee identity'
			USING ERRCODE = '23514';
	END IF;
	IF NOT (
		(
			EXISTS (
				SELECT 1 FROM exagram.share_allowed_emails
				WHERE workspace_id = target_workspace AND email = target_email
			)
		)
		AND (
			EXISTS (
				SELECT 1 FROM exagram.user_identities i
				WHERE i.user_id = NEW.grantee_id AND i.provider = 'google' AND lower(i.email::text) = target_email
			)
			OR EXISTS (
				SELECT 1 FROM exagram.users
				WHERE id = NEW.grantee_id AND password_hash = '!exagram:google-claim-required:v1!'
			)
		)
	) THEN
		RAISE EXCEPTION 'Restricted Shares grantee email is outside the allowlist'
			USING ERRCODE = '23514';
	END IF;
	NEW.shared_with_email := target_email;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "check_share_target"
	BEFORE INSERT OR UPDATE OF artifact_id, project_id, grantee_id, shared_with_email ON "exagram"."grants"
	FOR EACH ROW EXECUTE FUNCTION "exagram".check_share_target();

DROP VIEW "exagram"."reaching_grants";
DROP FUNCTION "exagram".user_artifact_grant_role(UUID, UUID);
DROP FUNCTION "exagram".group_member_count(UUID);
DROP FUNCTION "exagram".group_grant_audience(UUID, UUID, UUID);
DROP FUNCTION "exagram".group_grant_reaches(UUID, UUID, UUID, UUID);
DROP FUNCTION "exagram".share_eligible(UUID, UUID);

DROP INDEX "exagram"."grants_group_id_idx";
DROP INDEX "exagram"."grants_project_group_key";
DROP INDEX "exagram"."grants_artifact_group_key";
ALTER TABLE "exagram"."grants"
	DROP CONSTRAINT "grants_group_never_dormant",
	DROP CONSTRAINT "grants_grantee_xor",
	DROP COLUMN "group_id",
	ALTER COLUMN "grantee_id" SET NOT NULL;

CREATE VIEW "exagram"."reaching_grants" AS SELECT g.* FROM "exagram"."grants" g WHERE NOT g.dormant;

COMMIT;
