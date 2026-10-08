BEGIN;

ALTER TABLE exagram.projects ADD COLUMN restricted_shares boolean NOT NULL DEFAULT false;
ALTER TABLE exagram.artifacts ADD COLUMN restricted_shares boolean NOT NULL DEFAULT false;

CREATE FUNCTION exagram.check_share_scope_move() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_TABLE_NAME = 'artifacts' THEN
		IF NEW.restricted_shares AND NEW.project_id IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM exagram.projects WHERE id = NEW.project_id AND restricted_shares
		) THEN
			RAISE EXCEPTION 'Restricted Shares artifact cannot move into an unrestricted project'
				USING ERRCODE = '23514';
		END IF;
	END IF;
	IF TG_TABLE_NAME = 'projects' THEN
		IF NEW.restricted_shares AND NEW.parent_project_id IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM exagram.projects WHERE id = NEW.parent_project_id AND restricted_shares
		) THEN
			RAISE EXCEPTION 'Restricted Shares project cannot move under an unrestricted project'
				USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER check_artifact_share_scope_move
	BEFORE UPDATE OF project_id ON exagram.artifacts
	FOR EACH ROW EXECUTE FUNCTION exagram.check_share_scope_move();

CREATE TRIGGER check_project_share_scope_move
	BEFORE UPDATE OF parent_project_id ON exagram.projects
	FOR EACH ROW EXECUTE FUNCTION exagram.check_share_scope_move();

CREATE OR REPLACE FUNCTION exagram.check_share_target() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	target_workspace uuid;
	target_email text;
	grantee_workspace uuid;
	target_policy boolean;
BEGIN
	IF NEW.artifact_id IS NOT NULL THEN
		SELECT workspace_id, restricted_shares INTO target_workspace, target_policy
			FROM exagram.artifacts WHERE id = NEW.artifact_id;
	ELSE
		SELECT workspace_id, restricted_shares INTO target_workspace, target_policy
			FROM exagram.projects WHERE id = NEW.project_id;
	END IF;
	IF NOT target_policy OR NOT EXISTS (
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

COMMIT;
