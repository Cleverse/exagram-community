BEGIN;

UPDATE "exagram"."connections"
SET "revoked_at" = now()
WHERE "revoked_at" IS NULL AND "folder_access" = 'named';

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
		  AND (rr.revision_id IS NOT NULL OR (p_kind = 'user' AND rr.access = 'owner'))
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
		SELECT * FROM user_rows WHERE p_kind IN ('user', 'connection')
		UNION ALL
		SELECT * FROM link_row
	)
	SELECT DISTINCT ON (r.artifact_id) r.artifact_id, r.revision_id, r.access, r.pinned
	FROM all_rows r
	ORDER BY r.artifact_id, r.src_rank,
		CASE r.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END, r.pinned DESC
$$;

CREATE OR REPLACE FUNCTION "exagram".connection_readable_revisions(p_connection_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, seq INTEGER, status TEXT, is_default BOOLEAN)
LANGUAGE sql
STABLE
AS $$
	WITH c AS (
		SELECT id, user_id FROM "exagram"."connections"
		WHERE id = p_connection_id AND revoked_at IS NULL
	),
	reach AS (
		SELECT DISTINCT rr.artifact_id FROM c, "exagram".reach_rows(c.user_id) rr
	),
	cur AS (
		SELECT v.artifact_id, v.revision_id FROM "exagram".visible_artifacts('connection', p_connection_id) v
	)
	SELECT r.artifact_id, r.id, r.seq, r.status, (r.id = cur.revision_id) IS TRUE
	FROM c
	JOIN reach ON true
	JOIN "exagram"."revisions" r ON r.artifact_id = reach.artifact_id
	LEFT JOIN cur ON cur.artifact_id = r.artifact_id
	WHERE "exagram".artifact_owner(r.artifact_id) = c.user_id
	   OR r.id = cur.revision_id
	   OR (r.status = 'pending' AND r.author_connection_id = c.id)
$$;

DROP FUNCTION IF EXISTS "exagram".person_readable_artifact(UUID, UUID);
DROP FUNCTION IF EXISTS "exagram".connection_can_write_artifact(UUID, UUID);
DROP FUNCTION IF EXISTS "exagram".connection_artifact_right(UUID, UUID);
DROP FUNCTION IF EXISTS "exagram".connection_project_right(UUID, UUID);
DROP FUNCTION IF EXISTS "exagram".user_project_role(UUID, UUID);
DROP TABLE "exagram"."connection_folders";
ALTER TABLE "exagram"."connections"
	DROP COLUMN "other_files_access",
	DROP COLUMN "folder_access";

COMMIT;
