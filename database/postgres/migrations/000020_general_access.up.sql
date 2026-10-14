BEGIN;

ALTER TABLE "exagram"."artifacts" ADD COLUMN "general_access" TEXT NOT NULL DEFAULT 'restricted'
	CHECK ("general_access" IN ('restricted', 'org'));

CREATE TABLE "exagram"."workspace_org_domains" (
	"workspace_id" UUID PRIMARY KEY REFERENCES "exagram"."workspaces"("id") ON DELETE CASCADE,
	"domain" public.CITEXT NOT NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE FUNCTION "exagram".visible_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID)
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

COMMIT;
