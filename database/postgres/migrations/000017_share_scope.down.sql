BEGIN;

CREATE OR REPLACE FUNCTION exagram.check_share_target() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	target_workspace uuid;
	target_email text;
	grantee_workspace uuid;
BEGIN
	IF NEW.artifact_id IS NOT NULL THEN
		SELECT workspace_id INTO target_workspace FROM exagram.artifacts WHERE id = NEW.artifact_id;
	ELSE
		SELECT workspace_id INTO target_workspace FROM exagram.projects WHERE id = NEW.project_id;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM exagram.workspaces WHERE id = target_workspace AND restricted_shares
	) THEN
		RETURN NEW;
	END IF;
	SELECT lower(btrim(email::text)), workspace_id INTO target_email, grantee_workspace
		FROM exagram.users WHERE id = NEW.grantee_id;
	IF target_email IS NULL OR grantee_workspace IS DISTINCT FROM target_workspace OR (
		NEW.shared_with_email IS NOT NULL AND lower(btrim(NEW.shared_with_email)) <> target_email
	) THEN
		RAISE EXCEPTION 'Restricted Shares grant email does not match grantee identity'
			USING ERRCODE = '23514';
	END IF;
	IF NOT (
		EXISTS (
			SELECT 1 FROM exagram.share_allowed_emails
			WHERE workspace_id = target_workspace AND email = target_email
		)
	) THEN
		RAISE EXCEPTION 'Restricted Shares grantee email is outside the allowlist'
			USING ERRCODE = '23514';
	END IF;
	NEW.shared_with_email := target_email;
	RETURN NEW;
END;
$$;

DROP TRIGGER check_artifact_share_scope_move ON exagram.artifacts;
DROP TRIGGER check_project_share_scope_move ON exagram.projects;
DROP FUNCTION exagram.check_share_scope_move();
ALTER TABLE exagram.artifacts DROP COLUMN restricted_shares;
ALTER TABLE exagram.projects DROP COLUMN restricted_shares;

COMMIT;
