BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."users", "exagram"."memberships", "exagram"."ledger_serves", "exagram"."grants"
	IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
	guest_grants BIGINT;
BEGIN
	SELECT count(*) INTO guest_grants
	FROM "exagram"."grants" g
	LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
	JOIN "exagram"."users" u ON u.id = g.grantee_id
	WHERE NOT EXISTS (
		SELECT 1 FROM "exagram"."memberships" m
		WHERE m.user_id = g.grantee_id
		  AND m.workspace_id = COALESCE(a.workspace_id, p.workspace_id)
		  AND m.removed_at IS NULL
		  AND (m.invited_at IS NULL OR u.workspace_id = m.workspace_id)
	);
	IF EXISTS (
		SELECT 1 FROM "exagram"."memberships" m
		WHERE m.kind = 'team' AND m.removed_at IS NULL
		GROUP BY m.user_id HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION '000038 down: a person is invited to two Teams; remove one invite before migrating down';
	END IF;
	IF guest_grants > 0 THEN
		RAISE EXCEPTION '000038 down: % Grants reach a Guest with no live membership of the target''s Workspace; remove them before migrating down',
			guest_grants;
	END IF;
END
$$;

UPDATE "exagram"."users" u SET removed_at = m.removed_at
FROM "exagram"."memberships" m
WHERE m.user_id = u.id AND m.workspace_id = u.workspace_id AND m.kind = 'team'
  AND m.removed_at IS NOT NULL AND u.removed_at IS NULL;

DROP FUNCTION "exagram".invite_usable(uuid, text, text);
DROP FUNCTION "exagram".invite_usable(uuid, uuid, text, text);
CREATE FUNCTION "exagram".invite_usable(inviter UUID, invite_role TEXT, invite_via TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		JOIN "exagram"."workspaces" w ON w.id = u.workspace_id
		WHERE u.id = inviter AND u.removed_at IS NULL
			AND CASE invite_via
				WHEN 'member_invite' THEN invite_role = 'member' AND w.member_invites
				ELSE invite_role <> 'admin' OR u.is_admin
			END
	)
$$;

CREATE OR REPLACE FUNCTION "exagram".check_share_target() RETURNS TRIGGER
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

CREATE OR REPLACE FUNCTION "exagram".commentable_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN, org_only BOOLEAN)
LANGUAGE sql STABLE AS $$
	SELECT v.artifact_id, v.revision_id, v.access, v.pinned, v.org_only
	FROM "exagram".visible_artifact(p_kind, p_id, p_artifact_id) v
	WHERE NOT v.org_only
	   OR (p_kind = 'user' AND EXISTS (
		SELECT 1
		FROM "exagram"."users" u
		JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
		WHERE u.id = p_id AND u.workspace_id = a.workspace_id
	   ))
$$;

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
			OR (p_kind = 'user' AND EXISTS (
				SELECT 1 FROM "exagram"."users" u WHERE u.id = p_id AND u.removed_at IS NULL
			))
		))
		OR (a.general_access = 'org' AND p_kind = 'user' AND EXISTS (
			SELECT 1
			FROM "exagram"."users" u
			JOIN "exagram"."workspace_org_domains" d ON d.workspace_id = a.workspace_id
			JOIN "exagram"."user_identities" i ON i.user_id = u.id AND i.provider = 'google'
			WHERE u.id = p_id
			  AND u.removed_at IS NULL
			  AND u.workspace_id = a.workspace_id
			  AND right(i.email::TEXT, length(d.domain::TEXT) + 1)::public.CITEXT = ('@' || d.domain::TEXT)::public.CITEXT
		))
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM "exagram".visible_artifacts(p_kind, p_id) v
		WHERE v.artifact_id = p_artifact_id
	  )
$$;

DROP FUNCTION "exagram".grantee_pending(uuid, uuid);
DROP TRIGGER "ledger_serves_first_read" ON "exagram"."ledger_serves";
DROP FUNCTION "exagram".record_first_read();
DROP TABLE "exagram"."first_reads";
DROP FUNCTION "exagram".writer_in_workspace(uuid, uuid);
DROP FUNCTION "exagram".principal_live_member(text, uuid, uuid);
DROP FUNCTION "exagram".has_live_membership(uuid);
DROP FUNCTION "exagram".live_member(uuid, uuid);

DROP INDEX "exagram"."memberships_one_live_team_per_user";
CREATE UNIQUE INDEX "memberships_one_live_team_per_user"
	ON "exagram"."memberships" ("user_id") WHERE "kind" = 'team' AND "removed_at" IS NULL;

DROP TRIGGER "users_legacy_mirror" ON "exagram"."users";
DROP FUNCTION "exagram".users_legacy_mirror();

CREATE FUNCTION "exagram".users_sync_membership() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	moved BOOLEAN := TG_OP = 'UPDATE' AND OLD.workspace_id IS DISTINCT FROM NEW.workspace_id;
BEGIN
	IF moved THEN
		UPDATE "exagram"."memberships" SET removed_at = now()
		WHERE user_id = NEW.id AND workspace_id = OLD.workspace_id AND kind = 'team' AND removed_at IS NULL;
	END IF;

	IF TG_OP = 'INSERT' OR moved OR NOT EXISTS (
		SELECT 1 FROM "exagram"."memberships" m
		WHERE m.user_id = NEW.id AND m.workspace_id = NEW.workspace_id AND m.kind = 'team'
	) THEN
		INSERT INTO "exagram"."memberships"
			(user_id, workspace_id, kind, role, joined_at, last_seen_at, removed_at, invited_at, created_at)
		SELECT NEW.id, NEW.workspace_id, 'team', CASE WHEN NEW.is_admin THEN 'admin' ELSE 'member' END,
			NEW.joined_at, NEW.last_seen_at, NEW.removed_at, NEW.invited_at, NEW.created_at
		FROM "exagram"."workspaces" w
		WHERE w.id = NEW.workspace_id AND w.kind = 'team'
		  AND (NEW.removed_at IS NOT NULL OR NOT EXISTS (
			SELECT 1 FROM "exagram"."memberships" x
			WHERE x.user_id = NEW.id AND x.kind = 'team' AND x.removed_at IS NULL
		  ))
		ON CONFLICT (user_id, workspace_id) DO NOTHING;
		RETURN NULL;
	END IF;

	UPDATE "exagram"."memberships" m SET
		role = CASE WHEN OLD.is_admin IS DISTINCT FROM NEW.is_admin
			THEN CASE WHEN NEW.is_admin THEN 'admin' ELSE 'member' END ELSE m.role END,
		joined_at = CASE WHEN OLD.joined_at IS DISTINCT FROM NEW.joined_at THEN NEW.joined_at ELSE m.joined_at END,
		last_seen_at = CASE WHEN OLD.last_seen_at IS DISTINCT FROM NEW.last_seen_at
			THEN NEW.last_seen_at ELSE m.last_seen_at END,
		removed_at = CASE WHEN OLD.removed_at IS DISTINCT FROM NEW.removed_at THEN NEW.removed_at ELSE m.removed_at END,
		invited_at = CASE WHEN OLD.invited_at IS DISTINCT FROM NEW.invited_at THEN NEW.invited_at ELSE m.invited_at END
	WHERE m.user_id = NEW.id AND m.workspace_id = NEW.workspace_id AND m.kind = 'team'
	  AND (OLD.is_admin, OLD.joined_at, OLD.last_seen_at, OLD.removed_at, OLD.invited_at)
		IS DISTINCT FROM (NEW.is_admin, NEW.joined_at, NEW.last_seen_at, NEW.removed_at, NEW.invited_at);
	RETURN NULL;
END;
$$;

CREATE TRIGGER "users_sync_membership"
	AFTER INSERT OR UPDATE OF workspace_id, is_admin, joined_at, last_seen_at, removed_at, invited_at
	ON "exagram"."users"
	FOR EACH ROW EXECUTE FUNCTION "exagram".users_sync_membership();

COMMIT;
