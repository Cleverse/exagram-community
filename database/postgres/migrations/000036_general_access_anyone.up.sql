BEGIN;

-- A third General Access value. 000020 declared the check inline, so it carries the
-- name Postgres gave it.
ALTER TABLE "exagram"."artifacts"
	DROP CONSTRAINT "artifacts_general_access_check",
	ADD CONSTRAINT "artifacts_general_access_check"
		CHECK ("general_access" IN ('restricted', 'org', 'anyone'));

-- A signed-out read is a Ledger call of its own principal kind; its principal_id is the Artifact
-- it asked for, the only thing the reader presented.
ALTER TABLE "exagram"."ledger_calls"
	DROP CONSTRAINT "ledger_calls_principal_kind_check",
	ADD CONSTRAINT "ledger_calls_principal_kind_check"
		CHECK ("principal_kind" IN ('user','connection','link','operator','anonymous'));

-- Same signature and columns as 000020. The General Access row stands only when no Grant reached
-- the reader (the NOT EXISTS), so a pinned Grant still wins. 'anyone' admits an anonymous reader
-- naming the Artifact itself and any current (not removed) user of any Workspace; 'org' keeps
-- 000020's rule, now also for current users only. visible_artifacts returns nothing for
-- 'anonymous', so lists, search and MCP never widen.
CREATE OR REPLACE FUNCTION "exagram".visible_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN, org_only BOOLEAN)
LANGUAGE sql
STABLE
AS $$
	SELECT v.artifact_id, v.revision_id, v.access, v.pinned, false
	FROM "exagram".visible_artifacts(p_kind, p_id) v
	WHERE v.artifact_id = p_artifact_id
	UNION ALL
	SELECT a.id, a.current_revision_id, 'view'::TEXT, false, true
	FROM "exagram"."artifacts" a
	WHERE a.id = p_artifact_id
	  AND a.deleted_at IS NULL
	  AND a.current_revision_id IS NOT NULL
	  AND (
		(a.general_access = 'anyone' AND (
			(p_kind = 'anonymous' AND p_id = p_artifact_id)
			OR (p_kind = 'user' AND EXISTS (
				SELECT 1 FROM "exagram"."users" u WHERE u.id = p_id AND u.removed_at IS NULL
			))
		))
		OR (a.general_access = 'org' AND p_kind = 'user' AND EXISTS (
			SELECT 1
			FROM "exagram"."users" u
			JOIN "exagram"."workspace_org_domains" d ON d.workspace_id = a.workspace_id
			JOIN "exagram"."user_identities" i ON i.user_id = u.id AND i.provider = 'google'
			WHERE u.id = p_id
			  AND u.removed_at IS NULL
			  AND u.workspace_id = a.workspace_id
			  AND right(i.email::TEXT, length(d.domain::TEXT) + 1)::public.CITEXT = ('@' || d.domain::TEXT)::public.CITEXT
		))
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM "exagram".visible_artifacts(p_kind, p_id) v
		WHERE v.artifact_id = p_artifact_id
	  )
$$;

-- The boundary Comments use: visible_artifact's row, minus the readers 'anyone' admits from outside
-- the Artifact's Workspace. A Grant row (org_only false) always stands. A General Access row stands
-- only for a user of the Artifact's own Workspace, which 'org' already requires; the anonymous reader
-- and a signed-in person from another Workspace read at view and do nothing more.
CREATE FUNCTION "exagram".commentable_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN, org_only BOOLEAN)
LANGUAGE sql
STABLE
AS $$
	SELECT v.artifact_id, v.revision_id, v.access, v.pinned, v.org_only
	FROM "exagram".visible_artifact(p_kind, p_id, p_artifact_id) v
	WHERE NOT v.org_only
	   OR (p_kind = 'user' AND EXISTS (
		SELECT 1
		FROM "exagram"."users" u
		JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
		WHERE u.id = p_id AND u.workspace_id = a.workspace_id
	   ))
$$;

COMMIT;
