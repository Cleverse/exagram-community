BEGIN;

-- Revocations and the deleted oidc payloads from the up migration are not undone.
DROP FUNCTION IF EXISTS "exagram".connection_readable_revisions(UUID);

ALTER TABLE "exagram"."connections" ADD COLUMN "project_ids" UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE "exagram"."connections" ALTER COLUMN "project_ids" DROP DEFAULT;

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
		SELECT c.project_ids
		FROM "exagram"."connections" c
		WHERE p_kind = 'connection' AND c.id = p_id AND c.revoked_at IS NULL
	),
	-- Rule 1: everything the user owns, directly or through a project they own.
	owned AS (
		SELECT
			a.id AS artifact_id,
			a.current_revision_id AS revision_id,
			'owner'::TEXT AS access,
			0 AS src_rank,
			false AS pinned
		FROM "exagram"."artifacts" a, principal_user pu
		WHERE pu.user_id IS NOT NULL
		  AND a.deleted_at IS NULL
		  AND "exagram".artifact_owner(a.id) = pu.user_id
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
		JOIN principal_user pu ON pu.user_id = g.grantee_id
		JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		WHERE g.artifact_id IS NOT NULL AND a.deleted_at IS NULL
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
		JOIN principal_user pu ON pu.user_id = g.grantee_id
		JOIN "exagram"."projects" p ON p.id = g.project_id
		JOIN "exagram"."artifacts" a
			ON a.project_id = p.id
			OR a.project_id IN (
				SELECT cp.id FROM "exagram"."projects" cp WHERE cp.parent_project_id = p.id
			)
		WHERE g.project_id IS NOT NULL AND a.deleted_at IS NULL
	),
	-- A null revision_id survives here only so an owner sees their own pending-only Artifact;
	-- `scoped` drops it again for a Connection.
	user_rows AS (
		SELECT * FROM owned
		UNION ALL
		SELECT * FROM granted_direct WHERE revision_id IS NOT NULL
		UNION ALL
		SELECT * FROM granted_project WHERE revision_id IS NOT NULL
	),
	-- Rule 3: a connection sees its user's rows intersected with its project_ids. An artifact in no
	-- project is never in scope, and an empty project_ids array matches nothing.
	scoped AS (
		SELECT ur.*
		FROM user_rows ur
		WHERE p_kind = 'user'
		   OR (
			p_kind = 'connection'
			-- ADR 0013: a pending-only Artifact is invisible to a Connection, including one whose
			-- own write is the pending Revision.
			AND ur.revision_id IS NOT NULL
			AND EXISTS (
				SELECT 1
				FROM "exagram"."artifacts" a
				JOIN connection_scope cs ON true
				LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
				WHERE a.id = ur.artifact_id
				  AND a.project_id IS NOT NULL
				  AND (
					a.project_id = ANY (cs.project_ids)
					OR p.parent_project_id = ANY (cs.project_ids)
				  )
			)
		   )
	),
	-- Rule 4: one row for a link that is live, unexpired and not exhausted.
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
		SELECT * FROM scoped WHERE p_kind IN ('user', 'connection')
		UNION ALL
		SELECT * FROM link_row
	)
	-- One row per artifact. Owner beats a direct grant beats a project grant; within one source a
	-- pinned row beats an unpinned one, so a pin is never silently traded for a newer revision.
	SELECT DISTINCT ON (r.artifact_id) r.artifact_id, r.revision_id, r.access, r.pinned
	FROM all_rows r
	ORDER BY r.artifact_id, r.src_rank, r.pinned DESC
$$;

DROP FUNCTION IF EXISTS "exagram".reach_rows(UUID);

DROP INDEX IF EXISTS "exagram"."connections_live_user_client_key";

COMMIT;
