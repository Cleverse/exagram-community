BEGIN;

SET LOCAL lock_timeout = '5s';

-- Without the columns, a password, an expiry or a withheld download would silently stop applying. An
-- Artifact that had any of them closes to 'restricted' rather than opening wider than its Owner chose.
UPDATE "exagram"."artifacts" SET "general_access" = 'restricted'
WHERE "general_access" = 'anyone'
	AND ("anyone_password_on" OR "anyone_expires_at" IS NOT NULL OR NOT "anyone_download");

DROP TRIGGER "artifacts_notify_artifact" ON "exagram"."artifacts";
CREATE TRIGGER "artifacts_notify_artifact"
	AFTER UPDATE ON "exagram"."artifacts"
	FOR EACH ROW
	WHEN (
		OLD.title IS DISTINCT FROM NEW.title
		OR OLD.description IS DISTINCT FROM NEW.description
		OR OLD.project_id IS DISTINCT FROM NEW.project_id
		OR OLD.publish_policy IS DISTINCT FROM NEW.publish_policy
		OR OLD.redaction IS DISTINCT FROM NEW.redaction
		OR OLD.general_access IS DISTINCT FROM NEW.general_access
		OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
	)
	EXECUTE FUNCTION "exagram".artifacts_notify('artifact');

DROP FUNCTION "exagram".anyone_gate(TEXT, UUID, UUID, TEXT);
DROP FUNCTION "exagram".commentable_artifact(TEXT, UUID, UUID, TEXT);
DROP FUNCTION "exagram".visible_artifact(TEXT, UUID, UUID, TEXT);

CREATE FUNCTION "exagram".visible_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN, org_only BOOLEAN)
LANGUAGE sql STABLE AS $$
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
			OR (p_kind = 'user' AND EXISTS (SELECT 1 FROM "exagram"."users" u WHERE u.id = p_id))
		))
		OR (a.general_access = 'org' AND p_kind = 'user' AND "exagram".live_member(p_id, a.workspace_id) AND EXISTS (
			SELECT 1
			FROM "exagram"."workspace_org_domains" d
			JOIN "exagram"."user_identities" i ON i.user_id = p_id AND i.provider = 'google'
			WHERE d.workspace_id = a.workspace_id
			  AND right(i.email::TEXT, length(d.domain::TEXT) + 1)::public.CITEXT = ('@' || d.domain::TEXT)::public.CITEXT
		))
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM "exagram".visible_artifacts(p_kind, p_id) v
		WHERE v.artifact_id = p_artifact_id
	  )
$$;

CREATE FUNCTION "exagram".commentable_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN, org_only BOOLEAN)
LANGUAGE sql STABLE AS $$
	SELECT v.artifact_id, v.revision_id, v.access, v.pinned, v.org_only
	FROM "exagram".visible_artifact(p_kind, p_id, p_artifact_id) v
	WHERE NOT v.org_only
	   OR (p_kind = 'user' AND EXISTS (
		SELECT 1 FROM "exagram"."artifacts" a
		WHERE a.id = v.artifact_id AND "exagram".live_member(p_id, a.workspace_id)
	   ))
$$;

DROP TABLE "exagram"."anyone_unlocks";

ALTER TABLE "exagram"."artifacts"
	DROP CONSTRAINT "artifacts_anyone_password_check",
	DROP COLUMN "anyone_password_hash",
	DROP COLUMN "anyone_password_on",
	DROP COLUMN "anyone_expires_at",
	DROP COLUMN "anyone_download";

COMMIT;
