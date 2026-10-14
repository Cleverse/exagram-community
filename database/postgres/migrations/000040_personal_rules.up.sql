BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."grants", "exagram"."artifacts", "exagram"."projects",
	"exagram"."workspace_invites", "exagram"."join_requests", "exagram"."share_allowed_emails",
	"exagram"."workspace_org_domains"
	IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "exagram"."workspaces" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "exagram"."workspaces"
	ADD COLUMN "link_preview" TEXT NOT NULL DEFAULT 'metadata' CHECK ("link_preview" IN ('metadata', 'generic'));
UPDATE "exagram"."workspaces" SET "link_preview" = 'generic' WHERE "kind" = 'personal';
UPDATE "exagram"."projects" p SET "link_preview" = 'generic'
FROM "exagram"."workspaces" w WHERE w."id" = p."workspace_id" AND w."kind" = 'personal' AND p."link_preview" <> 'generic';

CREATE FUNCTION "exagram".is_personal(p_workspace UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (SELECT 1 FROM "exagram"."workspaces" w WHERE w.id = p_workspace AND w.kind = 'personal')
$$;

CREATE FUNCTION "exagram".is_personal_locked(p_workspace UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
	workspace_kind TEXT;
BEGIN
	SELECT w.kind INTO workspace_kind FROM "exagram"."workspaces" w WHERE w.id = p_workspace FOR KEY SHARE;
	RETURN COALESCE(workspace_kind = 'personal', FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION exagram.effective_publish_policy(p_artifact_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
	SELECT CASE WHEN w.kind = 'personal' THEN 'auto' ELSE COALESCE(a.publish_policy, p.publish_policy, 'auto') END
	FROM "exagram"."artifacts" a
	JOIN "exagram"."workspaces" w ON w.id = a.workspace_id
	LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
	WHERE a.id = p_artifact_id
$$;

CREATE OR REPLACE FUNCTION "exagram".effective_redaction(p_artifact_id uuid) RETURNS boolean
	LANGUAGE sql STABLE AS $$
	SELECT w.kind = 'team' AND coalesce(a.redaction, p.redaction, pp.redaction, w.redaction) = 'on'
	FROM "exagram"."artifacts" a
	JOIN "exagram"."workspaces" w ON w.id = a.workspace_id
	LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
	LEFT JOIN "exagram"."projects" pp ON pp.id = p.parent_project_id
	WHERE a.id = p_artifact_id;
$$;

CREATE FUNCTION "exagram".personal_workspace_rules() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	fresh BOOLEAN := TG_OP = 'INSERT' OR OLD.kind <> 'personal';
BEGIN
	IF NEW.redaction <> 'off' AND (fresh OR OLD.redaction IS DISTINCT FROM NEW.redaction) THEN
		RAISE EXCEPTION 'A Personal Workspace has no redaction.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.restricted_shares AND (fresh OR OLD.restricted_shares IS DISTINCT FROM NEW.restricted_shares) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Restricted Shares.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.seat_limit IS NOT NULL AND (fresh OR OLD.seat_limit IS DISTINCT FROM NEW.seat_limit) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Seats.' USING ERRCODE = 'EXP01';
	END IF;
	IF (
		(NEW.join_mode <> 'invite' AND (fresh OR OLD.join_mode IS DISTINCT FROM NEW.join_mode))
		OR (NEW.join_approval <> 'admin' AND (fresh OR OLD.join_approval IS DISTINCT FROM NEW.join_approval))
		OR (NEW.domain_link_enabled AND (fresh OR OLD.domain_link_enabled IS DISTINCT FROM NEW.domain_link_enabled))
		OR (NEW.member_invites AND (fresh OR OLD.member_invites IS DISTINCT FROM NEW.member_invites))
	) THEN
		RAISE EXCEPTION 'A Personal Workspace has no joining settings.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.default_share_role <> 'view' AND (fresh OR OLD.default_share_role IS DISTINCT FROM NEW.default_share_role) THEN
		RAISE EXCEPTION 'A Personal Workspace shares as Viewer by default.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.link_preview <> 'generic' AND (fresh OR OLD.link_preview IS DISTINCT FROM NEW.link_preview) THEN
		RAISE EXCEPTION 'A Personal Workspace shows every Link Preview as the generic card.' USING ERRCODE = 'EXP01';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "personal_workspace_rules"
	BEFORE INSERT OR UPDATE ON "exagram"."workspaces"
	FOR EACH ROW WHEN (NEW.kind = 'personal')
	EXECUTE FUNCTION "exagram".personal_workspace_rules();

CREATE FUNCTION "exagram".personal_flip_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	became UUID[];
	broken TEXT;
BEGIN
	SELECT array_agg(n.id) INTO became
	FROM new_rows n JOIN old_rows o ON o.id = n.id
	WHERE n.kind = 'personal' AND o.kind <> 'personal';
	IF became IS NULL THEN
		RETURN NULL;
	END IF;
	broken := CASE
		WHEN EXISTS (SELECT 1 FROM "exagram"."workspace_invites" WHERE workspace_id = ANY (became))
			THEN 'A Personal Workspace has no Invites.'
		WHEN EXISTS (SELECT 1 FROM "exagram"."join_requests" WHERE workspace_id = ANY (became))
			THEN 'A Personal Workspace has no Join Requests.'
		WHEN EXISTS (SELECT 1 FROM "exagram"."workspace_org_domains" WHERE workspace_id = ANY (became))
			THEN 'A Personal Workspace has no Allowed Domain.'
		WHEN EXISTS (SELECT 1 FROM "exagram"."share_allowed_emails" WHERE workspace_id = ANY (became))
			THEN 'A Personal Workspace has no Restricted Shares.'
		WHEN EXISTS (
			SELECT 1 FROM "exagram"."grants" g
			LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
			LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
			WHERE g.role = 'collaborate' AND COALESCE(a.workspace_id, p.workspace_id) = ANY (became)
		) THEN 'A Personal Workspace has no Collaborator role. Share as Viewer or Editor.'
		WHEN EXISTS (
			SELECT 1 FROM "exagram"."artifacts"
			WHERE workspace_id = ANY (became) AND general_access = 'org'
		) THEN 'A Personal Workspace cannot open an Artifact to everyone in the Workspace.'
		WHEN EXISTS (
			SELECT 1 FROM "exagram"."artifacts" WHERE workspace_id = ANY (became) AND publish_policy IS NOT NULL
		) OR EXISTS (
			SELECT 1 FROM "exagram"."projects" WHERE workspace_id = ANY (became) AND publish_policy <> 'auto'
		) THEN 'A Personal Workspace has no Publish Policy.'
		WHEN EXISTS (
			SELECT 1 FROM "exagram"."artifacts" WHERE workspace_id = ANY (became) AND redaction IS NOT NULL
		) OR EXISTS (
			SELECT 1 FROM "exagram"."projects" WHERE workspace_id = ANY (became) AND redaction IS NOT NULL
		) THEN 'A Personal Workspace has no redaction.'
		WHEN EXISTS (
			SELECT 1 FROM "exagram"."artifacts" WHERE workspace_id = ANY (became) AND restricted_shares
		) OR EXISTS (
			SELECT 1 FROM "exagram"."projects" WHERE workspace_id = ANY (became) AND restricted_shares
		) THEN 'A Personal Workspace has no Restricted Shares.'
		WHEN EXISTS (
			SELECT 1 FROM "exagram"."projects" WHERE workspace_id = ANY (became) AND link_preview <> 'generic'
		) THEN 'A Personal Workspace shows every Link Preview as the generic card.'
		WHEN EXISTS (
			SELECT 1 FROM "exagram"."revisions" r JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
			WHERE r.status = 'pending' AND a.workspace_id = ANY (became)
		) THEN 'A Personal Workspace has no Pending Revisions.'
	END;
	IF broken IS NOT NULL THEN
		RAISE EXCEPTION '%', broken USING ERRCODE = 'EXP01', DETAIL = 'Clean the Workspace before it becomes Personal.';
	END IF;
	RETURN NULL;
END;
$$;

CREATE TRIGGER "personal_flip_guard"
	AFTER UPDATE ON "exagram"."workspaces"
	REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
	FOR EACH STATEMENT EXECUTE FUNCTION "exagram".personal_flip_guard();

CREATE FUNCTION "exagram".refuse_personal_feature() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF "exagram".is_personal_locked(NEW.workspace_id) THEN
		RAISE EXCEPTION 'A Personal Workspace has no %.', TG_ARGV[0] USING ERRCODE = 'EXP01';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "personal_no_invites" BEFORE INSERT OR UPDATE OF workspace_id ON "exagram"."workspace_invites"
	FOR EACH ROW EXECUTE FUNCTION "exagram".refuse_personal_feature('Invites');
CREATE TRIGGER "personal_no_join_requests" BEFORE INSERT OR UPDATE OF workspace_id ON "exagram"."join_requests"
	FOR EACH ROW EXECUTE FUNCTION "exagram".refuse_personal_feature('Join Requests');
CREATE TRIGGER "personal_no_allowed_emails" BEFORE INSERT OR UPDATE OF workspace_id ON "exagram"."share_allowed_emails"
	FOR EACH ROW EXECUTE FUNCTION "exagram".refuse_personal_feature('Restricted Shares');
CREATE TRIGGER "personal_no_allowed_domain" BEFORE INSERT OR UPDATE OF workspace_id ON "exagram"."workspace_org_domains"
	FOR EACH ROW EXECUTE FUNCTION "exagram".refuse_personal_feature('Allowed Domain');

CREATE FUNCTION "exagram".personal_grant_rules() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF "exagram".is_personal_locked(COALESCE(
		(SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = NEW.artifact_id),
		(SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = NEW.project_id)
	)) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Collaborator role. Share as Viewer or Editor.'
			USING ERRCODE = 'EXP01';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "personal_grant_rules"
	BEFORE INSERT OR UPDATE OF role, artifact_id, project_id ON "exagram"."grants"
	FOR EACH ROW WHEN (NEW.role = 'collaborate')
	EXECUTE FUNCTION "exagram".personal_grant_rules();

CREATE FUNCTION "exagram".personal_artifact_rules() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF NOT "exagram".is_personal_locked(NEW.workspace_id) THEN
		RETURN NEW;
	END IF;
	IF NEW.general_access = 'org' AND (TG_OP = 'INSERT' OR OLD.general_access IS DISTINCT FROM NEW.general_access) THEN
		RAISE EXCEPTION 'A Personal Workspace cannot open an Artifact to everyone in the Workspace.'
			USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.publish_policy IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.publish_policy IS DISTINCT FROM NEW.publish_policy) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Publish Policy.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.redaction IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.redaction IS DISTINCT FROM NEW.redaction) THEN
		RAISE EXCEPTION 'A Personal Workspace has no redaction.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.restricted_shares AND (TG_OP = 'INSERT' OR OLD.restricted_shares IS DISTINCT FROM NEW.restricted_shares) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Restricted Shares.' USING ERRCODE = 'EXP01';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "personal_artifact_rules"
	BEFORE INSERT OR UPDATE OF general_access, publish_policy, redaction, restricted_shares ON "exagram"."artifacts"
	FOR EACH ROW WHEN (
		NEW.general_access = 'org' OR NEW.publish_policy IS NOT NULL OR NEW.redaction IS NOT NULL OR NEW.restricted_shares
	)
	EXECUTE FUNCTION "exagram".personal_artifact_rules();

CREATE FUNCTION "exagram".personal_project_rules() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF NOT "exagram".is_personal_locked(NEW.workspace_id) THEN
		RETURN NEW;
	END IF;
	IF NEW.publish_policy <> 'auto' AND (TG_OP = 'INSERT' OR OLD.publish_policy IS DISTINCT FROM NEW.publish_policy) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Publish Policy.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.redaction IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.redaction IS DISTINCT FROM NEW.redaction) THEN
		RAISE EXCEPTION 'A Personal Workspace has no redaction.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.restricted_shares AND (TG_OP = 'INSERT' OR OLD.restricted_shares IS DISTINCT FROM NEW.restricted_shares) THEN
		RAISE EXCEPTION 'A Personal Workspace has no Restricted Shares.' USING ERRCODE = 'EXP01';
	END IF;
	IF NEW.link_preview <> 'generic' AND (TG_OP = 'INSERT' OR OLD.link_preview IS DISTINCT FROM NEW.link_preview) THEN
		RAISE EXCEPTION 'A Personal Workspace shows every Link Preview as the generic card.' USING ERRCODE = 'EXP01';
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "personal_project_rules"
	BEFORE INSERT OR UPDATE OF publish_policy, redaction, restricted_shares, link_preview ON "exagram"."projects"
	FOR EACH ROW WHEN (
		NEW.publish_policy <> 'auto' OR NEW.redaction IS NOT NULL OR NEW.restricted_shares OR NEW.link_preview <> 'generic'
	)
	EXECUTE FUNCTION "exagram".personal_project_rules();

COMMIT;
