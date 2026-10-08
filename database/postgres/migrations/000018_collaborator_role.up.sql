BEGIN;

-- A third Grant role between view and edit. A Collaborator reads, invites up to Collaborator and
-- uploads Revisions that always wait for the Owner (ADR 0013). reach_rows carries g.role through
-- untouched, so 'collaborate' reaches every caller as an access value.
ALTER TABLE "exagram"."grants" DROP CONSTRAINT "grants_role_check";
ALTER TABLE "exagram"."grants" ADD CONSTRAINT "grants_role_check"
	CHECK ("role" IN ('view', 'collaborate', 'edit'));

-- The only way any read path learns which Artifact and which Revision a principal may see. Lists,
-- counts, search, reads, history visibility, comment visibility and body-token minting all resolve
-- here, so they cannot disagree. Nothing re-derives access in TypeScript.
--
-- access is 'owner' | 'edit' | 'collaborate' | 'view'. A null revision_id means "no body yet" and
-- reaches only an owner; grant, connection and link rows with a null revision are dropped.
-- `pinned` is true when the row was fixed to one Revision by a grant pin or a link, so no caller
-- has to compare two revision ids to find out — the comparison is itself a leak to a pinned reader.
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
	-- One row per artifact. Owner beats a direct grant beats a project grant; within one source the
	-- strongest role wins (edit, then collaborate, then view), then a pin beats an unpinned row.
	SELECT DISTINCT ON (r.artifact_id) r.artifact_id, r.revision_id, r.access, r.pinned
	FROM all_rows r
	ORDER BY r.artifact_id, r.src_rank,
		CASE r.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END, r.pinned DESC
$$;

-- Publish policy: 'auto' publishes an Owner's or Editor's upload the moment it lands, 'manual'
-- holds every upload for the Owner. A Project carries its own value (a child Project does not
-- inherit its parent's); an Artifact may override it, and NULL there means "follow the Project".
-- An Artifact outside any Project follows 'auto'.
ALTER TABLE "exagram"."projects" ADD COLUMN "publish_policy" TEXT NOT NULL DEFAULT 'auto'
	CHECK ("publish_policy" IN ('auto', 'manual'));
ALTER TABLE "exagram"."artifacts" ADD COLUMN "publish_policy" TEXT
	CHECK ("publish_policy" IN ('auto', 'manual'));

-- The one definition of which policy governs an Artifact.
CREATE FUNCTION exagram.effective_publish_policy(p_artifact_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
	SELECT COALESCE(a.publish_policy, p.publish_policy, 'auto')
	FROM "exagram"."artifacts" a
	LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
	WHERE a.id = p_artifact_id
$$;

-- Whether a person already reaches one Artifact: its Owner, a Grant on it, or a Grant on its
-- Project or that Project's parent. The same rules as reach_rows, for one Artifact instead of all,
-- so a per-person check (invite suggestions) never evaluates the whole boundary.
CREATE FUNCTION exagram.reaches_artifact(p_user_id uuid, p_artifact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
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
$$;

-- An upload publishes itself under 'auto': approved and Current the moment it lands.
-- approve_revision stays the Owner's alone (ADR 0013); this is the second and last writer of
-- artifacts.current_revision_id, and it only ever settles the author's own, user-authored
-- Revision while the Artifact's policy is 'auto' and the author's effective access (the row
-- visible_artifacts would pick) is 'owner' or 'edit'. A Collaborator's upload always waits.
CREATE FUNCTION exagram.publish_on_upload(p_revision_id uuid, p_author_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_artifact_id uuid;
  v_seq         int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('exagram:approve:' || p_revision_id::text));

  SELECT r.artifact_id, r.seq
    INTO v_artifact_id, v_seq
    FROM exagram.revisions r
    JOIN exagram.artifacts a ON a.id = r.artifact_id
   WHERE r.id = p_revision_id
     AND r.status = 'pending'
     AND r.author_user_id = p_author_user_id
     AND r.author_connection_id IS NULL
     AND a.deleted_at IS NULL
     AND exagram.effective_publish_policy(a.id) = 'auto'
     AND (
       SELECT rr.access
         FROM exagram.reach_rows(p_author_user_id) rr
        WHERE rr.artifact_id = a.id
        ORDER BY rr.src_rank,
          CASE rr.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END, rr.pinned DESC
        LIMIT 1
     ) IN ('owner', 'edit')
     FOR UPDATE OF r;

  IF v_artifact_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE exagram.revisions
     SET status = 'approved', approved_at = now()
   WHERE id = p_revision_id;

  UPDATE exagram.artifacts a
     SET current_revision_id = p_revision_id
   WHERE a.id = v_artifact_id
     AND (
       a.current_revision_id IS NULL
       OR v_seq > (SELECT c.seq FROM exagram.revisions c WHERE c.id = a.current_revision_id)
     );

  RETURN p_revision_id;
END $$;

COMMIT;
