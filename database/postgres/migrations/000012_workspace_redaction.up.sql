BEGIN;

ALTER TABLE "exagram"."workspaces"
	ADD COLUMN "redaction" TEXT NOT NULL DEFAULT 'on' CHECK ("redaction" IN ('on','off'));

-- Same signature as 000011's: the whole chain now ends in the Workspace's value instead of 'on'.
CREATE OR REPLACE FUNCTION "exagram".effective_redaction(p_artifact_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
	SELECT coalesce(a.redaction, p.redaction, pp.redaction, w.redaction) = 'on'
	FROM "exagram"."artifacts" a
	JOIN "exagram"."workspaces" w ON w.id = a.workspace_id
	LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
	LEFT JOIN "exagram"."projects" pp ON pp.id = p.parent_project_id
	WHERE a.id = p_artifact_id;
$$;

COMMIT;
