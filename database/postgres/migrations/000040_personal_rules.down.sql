BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."workspaces", "exagram"."grants", "exagram"."artifacts", "exagram"."projects",
	"exagram"."workspace_invites", "exagram"."join_requests", "exagram"."share_allowed_emails",
	"exagram"."workspace_org_domains"
	IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER "personal_project_rules" ON "exagram"."projects";
DROP FUNCTION "exagram".personal_project_rules();
DROP TRIGGER "personal_artifact_rules" ON "exagram"."artifacts";
DROP FUNCTION "exagram".personal_artifact_rules();
DROP TRIGGER "personal_grant_rules" ON "exagram"."grants";
DROP FUNCTION "exagram".personal_grant_rules();
DROP TRIGGER "personal_no_allowed_domain" ON "exagram"."workspace_org_domains";
DROP TRIGGER "personal_no_allowed_emails" ON "exagram"."share_allowed_emails";
DROP TRIGGER "personal_no_join_requests" ON "exagram"."join_requests";
DROP TRIGGER "personal_no_invites" ON "exagram"."workspace_invites";
DROP FUNCTION "exagram".refuse_personal_feature();
DROP TRIGGER "personal_flip_guard" ON "exagram"."workspaces";
DROP FUNCTION "exagram".personal_flip_guard();
DROP TRIGGER "personal_workspace_rules" ON "exagram"."workspaces";
DROP FUNCTION "exagram".personal_workspace_rules();

CREATE OR REPLACE FUNCTION "exagram".effective_redaction(p_artifact_id uuid) RETURNS boolean
	LANGUAGE sql STABLE AS $$
	SELECT coalesce(a.redaction, p.redaction, pp.redaction, w.redaction) = 'on'
	FROM "exagram"."artifacts" a
	JOIN "exagram"."workspaces" w ON w.id = a.workspace_id
	LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
	LEFT JOIN "exagram"."projects" pp ON pp.id = p.parent_project_id
	WHERE a.id = p_artifact_id;
$$;

CREATE OR REPLACE FUNCTION exagram.effective_publish_policy(p_artifact_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
	SELECT COALESCE(a.publish_policy, p.publish_policy, 'auto')
	FROM "exagram"."artifacts" a
	LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
	WHERE a.id = p_artifact_id
$$;

DROP FUNCTION "exagram".is_personal_locked(UUID);
ALTER TABLE "exagram"."workspaces" DROP COLUMN "link_preview";
DROP FUNCTION "exagram".is_personal(UUID);

COMMIT;
