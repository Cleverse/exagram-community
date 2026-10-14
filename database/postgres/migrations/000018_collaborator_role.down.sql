BEGIN;

DROP FUNCTION IF EXISTS exagram.publish_on_upload(uuid, uuid);
DROP FUNCTION IF EXISTS exagram.effective_publish_policy(uuid);
DROP FUNCTION IF EXISTS exagram.reaches_artifact(uuid, uuid);
ALTER TABLE "exagram"."artifacts" DROP COLUMN IF EXISTS "publish_policy";
ALTER TABLE "exagram"."projects" DROP COLUMN IF EXISTS "publish_policy";

-- Revisions published on upload stay approved and Current: the rollback does not unpublish them.

-- The only way any read path learns which Artifact and which Revision a principal may see. Lists,
-- counts, search, reads, history visibility, comment visibility and body-token minting all resolve
-- here, so they cannot disagree. Nothing re-derives access in TypeScript.
--
-- access is 'owner' | 'edit' | 'view'. A null revision_id means "no body yet" and reaches only an
-- owner; grant, connection and link rows with a null revision are dropped. `pinned` is true when
-- the row was fixed to one Revision by a grant pin or a link, so no caller has to compare two
-- revision ids to find out — the comparison is itself a leak to a pinned reader.
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
	user_rows AS (
		SELECT rr.artifact_id, rr.revision_id, rr.access, rr.src_rank, rr.pinned
		FROM principal_user pu, "exagram".reach_rows(pu.user_id) rr
		WHERE pu.user_id IS NOT NULL
		  -- A null revision is an Artifact with no Current Revision. It reaches a person only as
		  -- Owner, and never a Connection.
		  AND (rr.revision_id IS NOT NULL OR (p_kind = 'user' AND rr.access = 'owner'))
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
		SELECT * FROM user_rows WHERE p_kind IN ('user', 'connection')
		UNION ALL
		SELECT * FROM link_row
	)
	-- One row per artifact. Owner beats a direct grant beats a project grant; within one source the
	-- strongest role wins, then a pin beats an unpinned row.
	SELECT DISTINCT ON (r.artifact_id) r.artifact_id, r.revision_id, r.access, r.pinned
	FROM all_rows r
	ORDER BY r.artifact_id, r.src_rank, (r.access = 'edit') DESC, r.pinned DESC
$$;

-- A Collaborator falls back to a reader: the narrower role, so nobody gains a write on the way down.
UPDATE "exagram"."grants" SET "role" = 'view' WHERE "role" = 'collaborate';

ALTER TABLE "exagram"."grants" DROP CONSTRAINT "grants_role_check";
ALTER TABLE "exagram"."grants" ADD CONSTRAINT "grants_role_check" CHECK ("role" IN ('view', 'edit'));

COMMIT;
