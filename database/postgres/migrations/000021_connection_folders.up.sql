BEGIN;

ALTER TABLE "exagram"."connections"
	ADD COLUMN "folder_access" TEXT NOT NULL DEFAULT 'all'
		CHECK ("folder_access" IN ('all', 'named')),
	ADD COLUMN "other_files_access" TEXT NOT NULL DEFAULT 'none'
		CHECK ("other_files_access" IN ('none', 'view'));

CREATE TABLE "exagram"."connection_folders" (
	"connection_id" UUID NOT NULL REFERENCES "exagram"."connections"("id") ON DELETE CASCADE,
	"project_id" UUID NOT NULL REFERENCES "exagram"."projects"("id") ON DELETE CASCADE,
	"access" TEXT NOT NULL CHECK ("access" IN ('view', 'edit')),
	PRIMARY KEY ("connection_id", "project_id")
);

CREATE FUNCTION "exagram".user_project_role(p_user_id UUID, p_project_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
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
$$;

CREATE FUNCTION "exagram".connection_project_right(p_connection_id UUID, p_project_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
	WITH c AS (
		SELECT id, user_id, folder_access
		FROM "exagram"."connections"
		WHERE id = p_connection_id AND revoked_at IS NULL
	), project_role AS (
		SELECT c.id, c.folder_access, "exagram".user_project_role(c.user_id, p_project_id) AS role
		FROM c
	), entry AS (
		SELECT CASE
			WHEN f.access IS NOT NULL THEN f.access
			WHEN p.parent_project_id IS NOT NULL
				 AND "exagram".user_project_role(c.user_id, p.parent_project_id) IS NOT NULL
				THEN parent_f.access
			ELSE NULL
		END AS access
		FROM c
		JOIN "exagram"."projects" p ON p.id = p_project_id
		LEFT JOIN "exagram"."connection_folders" f
			ON f.connection_id = c.id AND f.project_id = p.id
		LEFT JOIN "exagram"."connection_folders" parent_f
			ON parent_f.connection_id = c.id AND parent_f.project_id = p.parent_project_id
	)
	SELECT CASE
		WHEN pr.role IS NULL THEN NULL
		WHEN pr.folder_access = 'all' THEN 'edit'
		WHEN e.access IS NULL THEN NULL
		WHEN e.access = 'view' OR pr.role = 'view' THEN 'view'
		WHEN e.access = 'edit' THEN 'edit'
		ELSE NULL
	END
	FROM project_role pr
	CROSS JOIN entry e
$$;

CREATE FUNCTION "exagram".connection_artifact_right(p_connection_id UUID, p_artifact_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
	WITH c AS (
		SELECT id, user_id, folder_access, other_files_access
		FROM "exagram"."connections"
		WHERE id = p_connection_id AND revoked_at IS NULL
	), a AS (
		SELECT id, project_id
		FROM "exagram"."artifacts"
		WHERE id = p_artifact_id AND deleted_at IS NULL
	)
	SELECT CASE
		WHEN c.folder_access = 'all' THEN 'edit'
		WHEN a.project_id IS NULL
			OR "exagram".user_project_role(c.user_id, a.project_id) IS NULL
			THEN CASE WHEN c.other_files_access = 'view' THEN 'view' ELSE NULL END
		ELSE "exagram".connection_project_right(c.id, a.project_id)
	END
	FROM c
	JOIN a ON true
$$;

CREATE FUNCTION "exagram".connection_can_write_artifact(p_connection_id UUID, p_artifact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
	SELECT COALESCE((
		SELECT rr.access IN ('owner', 'edit', 'collaborate')
		FROM "exagram"."connections" c, "exagram".reach_rows(c.user_id) rr
		WHERE c.id = p_connection_id
		  AND c.revoked_at IS NULL
		  AND rr.artifact_id = p_artifact_id
		ORDER BY rr.src_rank, rr.pinned DESC,
			CASE rr.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END
		LIMIT 1
	), false)
$$;

CREATE FUNCTION "exagram".person_readable_artifact(p_user_id UUID, p_artifact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM "exagram".reach_rows(p_user_id) rr
		WHERE rr.artifact_id = p_artifact_id
		  AND (rr.revision_id IS NOT NULL OR "exagram".artifact_owner(p_artifact_id) = p_user_id)
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
		SELECT c.id, c.user_id, c.folder_access, c.other_files_access
		FROM "exagram"."connections" c
		WHERE p_kind = 'connection' AND c.id = p_id AND c.revoked_at IS NULL
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
		  AND (p_kind = 'user' OR
			CASE
				WHEN cs.folder_access = 'all' THEN true
				WHEN a.project_id IS NULL OR cpr.person_role IS NULL
					THEN cs.other_files_access = 'view'
				WHEN COALESCE(cpr.self_access, cpr.parent_access) IS NULL THEN false
				ELSE true
			END)
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
		SELECT DISTINCT rr.artifact_id
		FROM c
		CROSS JOIN LATERAL "exagram".reach_rows(c.user_id) rr
		WHERE "exagram".connection_artifact_right(c.id, rr.artifact_id) IS NOT NULL
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

COMMIT;
