BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."users", "exagram"."memberships", "exagram"."ledger_serves", "exagram"."grants"
	IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER "users_sync_membership" ON "exagram"."users";
DROP FUNCTION "exagram".users_sync_membership();

CREATE FUNCTION "exagram".users_legacy_mirror() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		INSERT INTO "exagram"."memberships"
			(user_id, workspace_id, kind, role, joined_at, last_seen_at, removed_at, invited_at, created_at)
		SELECT NEW.id, NEW.workspace_id, 'team', CASE WHEN NEW.is_admin THEN 'admin' ELSE 'member' END,
			NEW.joined_at, NEW.last_seen_at, NEW.removed_at, NEW.invited_at, NEW.created_at
		FROM "exagram"."workspaces" w
		WHERE w.id = NEW.workspace_id AND w.kind = 'team'
		ON CONFLICT (user_id, workspace_id) DO NOTHING;
		RETURN NULL;
	END IF;

	UPDATE "exagram"."memberships" m SET
		role = CASE WHEN OLD.is_admin IS DISTINCT FROM NEW.is_admin
			THEN CASE WHEN NEW.is_admin THEN 'admin' ELSE 'member' END ELSE m.role END,
		invited_at = CASE WHEN OLD.invited_at IS DISTINCT FROM NEW.invited_at THEN NEW.invited_at ELSE m.invited_at END,
		joined_at = CASE WHEN OLD.joined_at IS DISTINCT FROM NEW.joined_at THEN NEW.joined_at ELSE m.joined_at END,
		last_seen_at = CASE WHEN OLD.last_seen_at IS DISTINCT FROM NEW.last_seen_at
			THEN NEW.last_seen_at ELSE m.last_seen_at END,
		removed_at = CASE WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN NEW.removed_at ELSE m.removed_at END
	WHERE m.user_id = NEW.id AND m.workspace_id = NEW.workspace_id AND m.kind = 'team' AND m.removed_at IS NULL
	  AND (
		(OLD.is_admin, OLD.invited_at, OLD.joined_at, OLD.last_seen_at)
			IS DISTINCT FROM (NEW.is_admin, NEW.invited_at, NEW.joined_at, NEW.last_seen_at)
		OR (OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL)
	  );
	RETURN NULL;
END;
$$;

CREATE TRIGGER "users_legacy_mirror"
	AFTER INSERT OR UPDATE OF is_admin, invited_at, joined_at, last_seen_at, removed_at ON "exagram"."users"
	FOR EACH ROW EXECUTE FUNCTION "exagram".users_legacy_mirror();

CREATE FUNCTION "exagram".live_member(p_user UUID, p_workspace UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."memberships" m
		WHERE m.user_id = p_user AND m.workspace_id = p_workspace AND m.removed_at IS NULL AND m.invited_at IS NULL
	)
$$;

CREATE FUNCTION "exagram".has_live_membership(p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."memberships" m
		WHERE m.user_id = p_user AND m.removed_at IS NULL AND m.invited_at IS NULL
	)
$$;

CREATE FUNCTION "exagram".principal_live_member(p_kind TEXT, p_id UUID, p_workspace UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT CASE p_kind
		WHEN 'user' THEN "exagram".live_member(p_id, p_workspace)
		WHEN 'connection' THEN EXISTS (
			SELECT 1 FROM "exagram"."connections" c
			WHERE c.id = p_id AND c.revoked_at IS NULL AND "exagram".live_member(c.user_id, p_workspace)
		)
		ELSE false
	END
$$;

DROP INDEX "exagram"."memberships_one_live_team_per_user";
CREATE UNIQUE INDEX "memberships_one_live_team_per_user"
	ON "exagram"."memberships" ("user_id") WHERE "kind" = 'team' AND "removed_at" IS NULL AND "invited_at" IS NULL;

CREATE FUNCTION "exagram".writer_in_workspace(p_user UUID, p_workspace UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
	PERFORM 1 FROM "exagram"."memberships" m
	WHERE m.user_id = p_user AND m.workspace_id = p_workspace
	FOR SHARE;
	RETURN "exagram".live_member(p_user, p_workspace);
END;
$$;

CREATE TABLE "exagram"."first_reads" (
	"user_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id") ON DELETE CASCADE,
	"read_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY ("user_id", "workspace_id")
);

CREATE FUNCTION "exagram".record_first_read() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "exagram"."first_reads" (user_id, workspace_id)
	SELECT COALESCE(k.user_id, c.principal_id), a.workspace_id
	FROM "exagram"."ledger_calls" c
	JOIN "exagram"."artifacts" a ON a.id = NEW.artifact_id
	LEFT JOIN "exagram"."connections" k ON c.principal_kind = 'connection' AND k.id = c.principal_id
	WHERE c.id = NEW.call_id AND c.principal_kind IN ('user', 'connection')
	  AND c.action IN (
		'artifacts.get', 'revisions.text', 'revisions.revisionText', 'revisions.bodyToken', 'revisions.bodyTokenAt',
		'artifact_read'
	  )
	ON CONFLICT (user_id, workspace_id) DO UPDATE SET read_at = EXCLUDED.read_at
	WHERE "first_reads".read_at < (
		SELECT m.removed_at FROM "exagram"."memberships" m
		WHERE m.user_id = "first_reads".user_id AND m.workspace_id = "first_reads".workspace_id
	);
	RETURN NULL;
END;
$$;

CREATE TRIGGER "ledger_serves_first_read"
	AFTER INSERT ON "exagram"."ledger_serves"
	FOR EACH ROW WHEN (NEW.outcome = 'served' AND NEW.artifact_id IS NOT NULL)
	EXECUTE FUNCTION "exagram".record_first_read();

-- A grantee the sharer sees only by email: an Invited Member nobody has signed in as, or a Guest, or someone
-- removed from the Workspace, who has not opened anything of it since. They look alike, so a share by email
-- never says which emails already have an account elsewhere.
CREATE FUNCTION "exagram".grantee_pending(p_user UUID, p_workspace UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT NOT "exagram".live_member(p_user, p_workspace) AND NOT EXISTS (
		SELECT 1 FROM "exagram"."first_reads" f
		LEFT JOIN "exagram"."memberships" m ON m.user_id = f.user_id AND m.workspace_id = f.workspace_id
		WHERE f.user_id = p_user AND f.workspace_id = p_workspace
		  AND (m.removed_at IS NULL OR f.read_at > m.removed_at)
	)
$$;

-- General Access `org` needs a live, claimed Team membership of the Artifact's Workspace; `anyone` needs only
-- an account, since a Team removal no longer ends one. A Grant reaches its target whether or not the grantee
-- is a member (a Guest).
CREATE OR REPLACE FUNCTION "exagram".visible_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID)
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

CREATE OR REPLACE FUNCTION "exagram".commentable_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID)
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

CREATE OR REPLACE FUNCTION "exagram".check_share_target() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	target_workspace uuid;
	target_email text;
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
	SELECT lower(btrim(email::text)) INTO target_email
		FROM exagram.users WHERE id = NEW.grantee_id;
	IF target_email IS NULL OR (
		NEW.shared_with_email IS NOT NULL AND lower(btrim(NEW.shared_with_email)) <> target_email
	) THEN
		RAISE EXCEPTION 'Restricted Shares grant email does not match grantee identity'
			USING ERRCODE = '23514';
	END IF;
	IF NOT (
		(
			EXISTS (
				SELECT 1 FROM exagram.share_allowed_emails
				WHERE workspace_id = target_workspace AND email = target_email
			)
		)
		AND (
			EXISTS (
				SELECT 1 FROM exagram.user_identities i
				WHERE i.user_id = NEW.grantee_id AND i.provider = 'google' AND lower(i.email::text) = target_email
			)
			OR EXISTS (
				SELECT 1 FROM exagram.users
				WHERE id = NEW.grantee_id AND password_hash = '!exagram:google-claim-required:v1!'
			)
		)
	) THEN
		RAISE EXCEPTION 'Restricted Shares grantee email is outside the allowlist'
			USING ERRCODE = '23514';
	END IF;
	NEW.shared_with_email := target_email;
	RETURN NEW;
END;
$$;

CREATE FUNCTION "exagram".invite_usable(inviter UUID, invite_workspace UUID, invite_role TEXT, invite_via TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."memberships" m
		JOIN "exagram"."workspaces" w ON w.id = m.workspace_id
		WHERE m.user_id = inviter AND m.workspace_id = invite_workspace
			AND "exagram".live_member(inviter, invite_workspace)
			AND CASE invite_via
				WHEN 'member_invite' THEN invite_role = 'member' AND w.member_invites
				ELSE invite_role <> 'admin' OR m.role = 'admin'
			END
	)
$$;
CREATE OR REPLACE FUNCTION "exagram".invite_usable(inviter UUID, invite_role TEXT, invite_via TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT "exagram".invite_usable(
		inviter, (SELECT u.workspace_id FROM "exagram"."users" u WHERE u.id = inviter), invite_role, invite_via
	)
$$;

COMMIT;
