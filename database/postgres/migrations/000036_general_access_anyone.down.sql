BEGIN;

DROP FUNCTION "exagram".commentable_artifact(TEXT, UUID, UUID);

-- 000020's function body, before the 'anyone' tier.
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
	JOIN "exagram"."users" u ON u.id = p_id AND u.workspace_id = a.workspace_id
	JOIN "exagram"."workspace_org_domains" d ON d.workspace_id = a.workspace_id
	WHERE p_kind = 'user'
	  AND a.id = p_artifact_id
	  AND a.general_access = 'org'
	  AND a.deleted_at IS NULL
	  AND a.current_revision_id IS NOT NULL
	  AND EXISTS (
		SELECT 1 FROM "exagram"."user_identities" i
		WHERE i.user_id = u.id AND i.provider = 'google'
		  AND right(i.email::TEXT, length(d.domain::TEXT) + 1)::public.CITEXT = ('@' || d.domain::TEXT)::public.CITEXT
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM "exagram".visible_artifacts(p_kind, p_id) v
		WHERE v.artifact_id = p_artifact_id
	  )
$$;

-- An Artifact open to anyone closes back to Restricted; nothing else can hold it.
UPDATE "exagram"."artifacts" SET "general_access" = 'restricted' WHERE "general_access" = 'anyone';

ALTER TABLE "exagram"."artifacts"
	DROP CONSTRAINT "artifacts_general_access_check",
	ADD CONSTRAINT "artifacts_general_access_check"
		CHECK ("general_access" IN ('restricted', 'org'));

-- NOT VALID keeps the anonymous reads already in the Ledger rather than deleting history, the way
-- 000028's down keeps the operator's; new rows are checked.
ALTER TABLE "exagram"."ledger_calls"
	DROP CONSTRAINT "ledger_calls_principal_kind_check",
	ADD CONSTRAINT "ledger_calls_principal_kind_check"
		CHECK ("principal_kind" IN ('user','connection','link','operator')) NOT VALID;

COMMIT;
