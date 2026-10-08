BEGIN;

-- ADR 0018 ends per-Connection Project confinement. A Connection consented under the old rule
-- named a narrow list; it is ended rather than widened, and its AI tool consents again.
DELETE FROM "exagram"."oidc_payloads" op
USING "exagram"."connections" c
WHERE c.revoked_at IS NULL AND c.oidc_grant_id IS NOT NULL AND op.grant_id = c.oidc_grant_id;

UPDATE "exagram"."connections" SET revoked_at = now() WHERE revoked_at IS NULL;

ALTER TABLE "exagram"."connections" DROP COLUMN "project_ids";

CREATE UNIQUE INDEX "connections_live_user_client_key"
	ON "exagram"."connections" ("user_id", "oidc_client_id") WHERE "revoked_at" IS NULL;

-- The user_id's reach: everything they own, directly or through a project they own, plus every
-- grant reachable directly or through a project (and its one level of children). Keyed on
-- p_user_id so a Connection's reach is its person's, evaluated live. No null filter, no
-- dedupe: each caller decides what a null revision or an unpinned duplicate means for it.
CREATE FUNCTION "exagram".reach_rows(p_user_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, src_rank INT, pinned BOOLEAN)
LANGUAGE sql
STABLE
AS $$
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
$$;

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
		  -- Owner, and never a Connection: ADR 0017 serves those through
		  -- connection_readable_revisions, on request.
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
	-- One row per artifact. Owner beats a direct grant beats a project grant; within one source a
	-- pinned row beats an unpinned one, so a pin is never silently traded for a newer revision.
	SELECT DISTINCT ON (r.artifact_id) r.artifact_id, r.revision_id, r.access, r.pinned
	FROM all_rows r
	ORDER BY r.artifact_id, r.src_rank, r.pinned DESC
$$;

-- Every Revision a Connection may be served, and the only place ADR 0017's rule lives. Authorship
-- alone never authorizes: a row exists only while the Connection is live and its person reaches
-- the Artifact today, so a revoked Connection, a removed Grant or an Artifact moved under another
-- Owner ends it.
CREATE FUNCTION "exagram".connection_readable_revisions(p_connection_id UUID)
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

COMMIT;
