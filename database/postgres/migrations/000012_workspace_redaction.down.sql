BEGIN;

CREATE OR REPLACE FUNCTION "exagram".effective_redaction(p_artifact_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
	SELECT coalesce(a.redaction, p.redaction, pp.redaction, 'on') = 'on'
	FROM "exagram"."artifacts" a
	LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
	LEFT JOIN "exagram"."projects" pp ON pp.id = p.parent_project_id
	WHERE a.id = p_artifact_id;
$$;

ALTER TABLE "exagram"."workspaces" DROP COLUMN IF EXISTS "redaction";

COMMIT;
