BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."workspaces", "exagram"."memberships", "exagram"."users", "exagram"."sessions",
	"exagram"."connections", "exagram"."artifacts", "exagram"."projects", "exagram"."password_resets",
	"exagram"."grants", "exagram"."user_identities"
	IN ACCESS EXCLUSIVE MODE;

-- Once 000044 has turned a Team with files into a Personal Workspace, or anyone has used one, this refuses: a Team
-- cannot hold what a Personal Workspace holds, and nothing here moves files between Workspaces.
DO $$
DECLARE
	holding BIGINT;
	sleeping BIGINT;
BEGIN
	SELECT count(*) INTO holding
	FROM "exagram"."workspaces" w
	WHERE w.kind = 'personal' AND (
		EXISTS (SELECT 1 FROM "exagram"."artifacts" a WHERE a.workspace_id = w.id)
		OR EXISTS (SELECT 1 FROM "exagram"."projects" p WHERE p.workspace_id = w.id)
		OR EXISTS (SELECT 1 FROM "exagram"."connections" c WHERE c.workspace_id = w.id)
		OR EXISTS (SELECT 1 FROM "exagram"."users" u WHERE u.workspace_id = w.id AND "exagram".bare_account(u.id))
		OR (
			EXISTS (SELECT 1 FROM "exagram"."users" u WHERE u.workspace_id = w.id AND u.id IS DISTINCT FROM w.owner_id)
			AND NOT EXISTS (
				SELECT 1 FROM "exagram"."users" u
				WHERE u.workspace_id = w.id AND u.id = w.owner_id AND "exagram".live_team_of(u.id) IS NULL
			)
		)
	);
	SELECT count(*) INTO sleeping FROM "exagram"."grants" WHERE dormant;
	IF holding > 0 OR sleeping > 0 THEN
		RAISE EXCEPTION '000044 down: % Personal Workspaces hold files, folders, Connections or shared-with accounts, and % shares wait for an email to be proven; a Team cannot hold them, so move or delete them first',
			holding, sleeping;
	END IF;
END
$$;

CREATE OR REPLACE FUNCTION "exagram".connection_covers_workspace(p_connection_id UUID, p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM "exagram"."connections" c
		WHERE c."id" = p_connection_id
		  AND c."revoked_at" IS NULL
		  AND "exagram".live_member(c."user_id", c."workspace_id")
		  AND p_workspace_id IS NOT NULL
		  AND (
			c."workspace_id" = p_workspace_id
			OR (
				(SELECT bound."kind" FROM "exagram"."workspaces" bound WHERE bound."id" = c."workspace_id") = 'personal'
				AND NOT "exagram".live_member(c."user_id", p_workspace_id)
			)
		  )
	)
$$;

CREATE OR REPLACE FUNCTION "exagram".visible_artifacts(p_kind TEXT, p_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN)
LANGUAGE sql
STABLE
AS $$
	WITH principal_user AS (
		SELECT CASE
			WHEN p_kind = 'user' THEN p_id
			WHEN p_kind = 'connection' THEN (
				SELECT c.user_id
				FROM "exagram"."connections" c
				WHERE c.id = p_id AND c.revoked_at IS NULL
			)
		END AS user_id
	),
	connection_scope AS (
		SELECT c.id, c.user_id, c.folder_access, c.other_files_access, c.workspace_id, bound.kind AS workspace_kind
		FROM "exagram"."connections" c
		JOIN "exagram"."workspaces" bound ON bound.id = c.workspace_id
		WHERE p_kind = 'connection' AND c.id = p_id AND c.revoked_at IS NULL
		  AND "exagram".live_member(c.user_id, c.workspace_id)
	),
	member_workspaces AS (
		SELECT m.workspace_id
		FROM "exagram"."memberships" m
		JOIN connection_scope cs ON cs.user_id = m.user_id
		WHERE "exagram".live_member(m.user_id, m.workspace_id)
	),
	connection_project_rights AS (
		SELECT
			cs.id AS connection_id,
			p.id AS project_id,
			"exagram".user_project_role(cs.user_id, p.id) AS person_role,
			cs.folder_access,
			cs.other_files_access,
			self_entry.access AS self_access,
			CASE WHEN p.parent_project_id IS NOT NULL
				AND "exagram".user_project_role(cs.user_id, p.parent_project_id) IS NOT NULL
				THEN parent_entry.access END AS parent_access
		FROM connection_scope cs
		JOIN "exagram"."projects" p ON true
		LEFT JOIN "exagram"."connection_folders" self_entry
			ON self_entry.connection_id = cs.id AND self_entry.project_id = p.id
		LEFT JOIN "exagram"."connection_folders" parent_entry
			ON parent_entry.connection_id = cs.id AND parent_entry.project_id = p.parent_project_id
	),
	user_rows AS (
		SELECT rr.artifact_id, rr.revision_id, rr.access, rr.src_rank, rr.pinned
		FROM principal_user pu
		CROSS JOIN LATERAL "exagram".reach_rows(pu.user_id) rr
		LEFT JOIN "exagram"."artifacts" a ON a.id = rr.artifact_id
		LEFT JOIN connection_scope cs ON cs.id = p_id
		LEFT JOIN connection_project_rights cpr
			ON cpr.connection_id = p_id AND cpr.project_id = a.project_id
		WHERE pu.user_id IS NOT NULL
		  AND (rr.revision_id IS NOT NULL OR (p_kind = 'user' AND rr.access = 'owner'))
		  AND (p_kind = 'user' OR (
			(
				a.workspace_id = cs.workspace_id
				OR (cs.workspace_kind = 'personal' AND a.workspace_id NOT IN (SELECT workspace_id FROM member_workspaces))
			)
			AND CASE
				WHEN cs.folder_access = 'all' THEN true
				WHEN a.project_id IS NULL OR cpr.person_role IS NULL
					THEN cs.other_files_access = 'view'
				WHEN COALESCE(cpr.self_access, cpr.parent_access) IS NULL THEN false
				ELSE true
			END))
	),
	link_row AS (
		SELECT
			l.artifact_id,
			l.revision_id,
			'view'::TEXT AS access,
			3 AS src_rank,
			true AS pinned
		FROM "exagram"."links" l
		JOIN "exagram"."artifacts" a ON a.id = l.artifact_id
		WHERE p_kind = 'link'
		  AND l.id = p_id
		  AND l.revoked_at IS NULL
		  AND l.expires_at > now()
		  AND (l.max_views IS NULL OR l.views_used < l.max_views)
		  AND a.deleted_at IS NULL
	),
	all_rows AS (
		SELECT * FROM user_rows WHERE p_kind IN ('user', 'connection') AND access IS NOT NULL
		UNION ALL
		SELECT * FROM link_row
	)
	SELECT DISTINCT ON (r.artifact_id) r.artifact_id, r.revision_id, r.access, r.pinned
	FROM all_rows r
	ORDER BY r.artifact_id, r.src_rank,
		CASE r.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END, r.pinned DESC
$$;

DROP FUNCTION "exagram".principal_scope_covers(TEXT, UUID, UUID, UUID);
DROP TRIGGER "connections_binding_covers_outside" ON "exagram"."connections";
DROP FUNCTION "exagram".connection_binding_covers_outside();
ALTER TABLE "exagram"."connections" DROP COLUMN "covers_outside";
DROP FUNCTION "exagram".admin_reset_refused(UUID, UUID);
DROP FUNCTION "exagram".claim_unclaimed_account(UUID, TEXT, TEXT);
DROP FUNCTION "exagram".lock_unclaimed_account(UUID);
DROP TRIGGER "memberships_went_live" ON "exagram"."memberships";
DROP FUNCTION "exagram".membership_went_live();
DROP FUNCTION "exagram".bare_account(UUID);

CREATE OR REPLACE FUNCTION "exagram".reach_rows(p_user_id UUID)
RETURNS TABLE(artifact_id UUID, revision_id UUID, access TEXT, src_rank INTEGER, pinned BOOLEAN)
LANGUAGE sql STABLE AS $function$
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
		FROM "exagram"."grants" g
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

CREATE OR REPLACE FUNCTION "exagram".reaches_artifact(p_user_id UUID, p_artifact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $function$
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
				WHERE g.grantee_id = p_user_id
				  AND (g.artifact_id = a.id OR g.project_id IN (p.id, p.parent_project_id))
			)
		  )
	)
$function$;

CREATE OR REPLACE FUNCTION "exagram".user_project_role(p_user_id UUID, p_project_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE AS $function$
	SELECT CASE
		WHEN p.owner_id = p_user_id THEN 'owner'::TEXT
		ELSE (
			SELECT g.role
			FROM "exagram"."grants" g
			WHERE g.grantee_id = p_user_id
			  AND g.project_id IN (p.id, p.parent_project_id)
			ORDER BY CASE g.role WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END
			LIMIT 1
		)
	END
	FROM "exagram"."projects" p
	WHERE p.id = p_project_id
$function$;

CREATE OR REPLACE FUNCTION "exagram".reach_set(p_artifact_id UUID, p_owner_id UUID, p_project_id UUID)
RETURNS UUID[]
LANGUAGE sql STABLE AS $function$
	SELECT array_agg(DISTINCT x.user_id ORDER BY x.user_id)
	FROM (
		SELECT COALESCE(p.owner_id, p_owner_id) AS user_id
		FROM (SELECT 1) one
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		UNION
		SELECT g.grantee_id
		FROM "exagram"."grants" g
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		WHERE g.artifact_id = p_artifact_id
		   OR g.project_id IN (p.id, p.parent_project_id)
	) x
$function$;

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

DROP TRIGGER "grants_notify_update" ON "exagram"."grants";
CREATE TRIGGER "grants_notify_update"
	AFTER UPDATE OF role, pinned_revision_id ON "exagram"."grants"
	FOR EACH ROW
	WHEN (OLD.role IS DISTINCT FROM NEW.role OR OLD.pinned_revision_id IS DISTINCT FROM NEW.pinned_revision_id)
	EXECUTE FUNCTION "exagram".grants_notify();

DROP FUNCTION "exagram".wake_grants(UUID);
ALTER TABLE "exagram"."grants" DROP COLUMN "woken_at";
ALTER TABLE "exagram"."grants" DROP COLUMN "dormant";
DROP FUNCTION "exagram".email_proven(UUID);
ALTER TABLE "exagram"."users" DROP COLUMN "email_proven_legacy";

ALTER TABLE "exagram"."password_resets" DROP COLUMN "workspace_id";

UPDATE "exagram"."users" u SET workspace_id = m.workspace_id, is_admin = (m.role = 'admin')
FROM "exagram"."memberships" m
WHERE "exagram".is_personal(u.workspace_id)
  AND m.user_id = u.id AND m.kind = 'team' AND m.removed_at IS NULL AND m.invited_at IS NULL;

DROP FUNCTION "exagram".live_team_of(UUID);
DROP FUNCTION "exagram".ensure_personal_workspace(UUID);
DROP FUNCTION "exagram".create_personal_workspace(UUID);

-- A Personal Workspace that is still its person's home is the only Workspace they have, as a Team was before 000044.
UPDATE "exagram"."workspaces" w SET kind = 'team'
WHERE w.kind = 'personal' AND EXISTS (SELECT 1 FROM "exagram"."users" u WHERE u.workspace_id = w.id);

UPDATE "exagram"."sessions" s SET workspace_id = u.workspace_id
FROM "exagram"."users" u, "exagram"."workspaces" w
WHERE u.id = s.user_id AND w.id = s.workspace_id AND w.kind = 'personal';

DELETE FROM "exagram"."memberships" WHERE kind = 'personal';
DELETE FROM "exagram"."workspaces" WHERE kind = 'personal';

COMMIT;
