BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."memberships" IN EXCLUSIVE MODE;
LOCK TABLE "exagram"."users", "exagram"."sessions", "exagram"."connections" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "exagram"."users"
	ADD COLUMN "workspace_id" UUID CONSTRAINT "users_workspace_id_fkey" REFERENCES "exagram"."workspaces"("id"),
	ADD COLUMN "is_admin" BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN "invited_at" TIMESTAMPTZ,
	ADD COLUMN "removed_at" TIMESTAMPTZ,
	ADD COLUMN "last_seen_at" TIMESTAMPTZ,
	ADD COLUMN "joined_at" TIMESTAMPTZ;
CREATE INDEX "users_workspace_id_idx" ON "exagram"."users" ("workspace_id");

CREATE FUNCTION "exagram".legacy_home(p_user UUID) RETURNS SETOF "exagram"."memberships"
LANGUAGE sql STABLE AS $$
	SELECT m.* FROM "exagram"."memberships" m
	WHERE m.user_id = p_user
	ORDER BY (m.kind = 'team' AND m.removed_at IS NULL AND m.invited_at IS NULL) DESC,
		(m.kind = 'personal') DESC, (m.invited_at IS NULL) DESC, m.created_at, m.workspace_id
	LIMIT 1
$$;

CREATE FUNCTION "exagram".copy_legacy_home(p_user UUID) RETURNS VOID
LANGUAGE sql AS $$
	UPDATE "exagram"."users" u SET
		workspace_id = h.workspace_id, is_admin = h.role = 'admin', joined_at = h.joined_at,
		last_seen_at = h.last_seen_at, removed_at = h.removed_at
	FROM "exagram".legacy_home(p_user) h
	WHERE u.id = p_user
	  AND (u.workspace_id, u.is_admin, u.joined_at, u.last_seen_at, u.removed_at)
		IS DISTINCT FROM (h.workspace_id, h.role = 'admin', h.joined_at, h.last_seen_at, h.removed_at)
$$;

SELECT "exagram".copy_legacy_home(u.id) FROM "exagram"."users" u;
UPDATE "exagram"."users" SET invited_at = created_at WHERE unclaimed;
UPDATE "exagram"."users" u SET workspace_id = (
	SELECT COALESCE(a.workspace_id, p.workspace_id)
	FROM "exagram"."grants" g
	LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
	WHERE g.grantee_id = u.id
	ORDER BY g.created_at, g.id
	LIMIT 1
)
WHERE u.workspace_id IS NULL;

CREATE FUNCTION "exagram".users_sync_unclaimed() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.invited_at IS NOT NULL THEN
			NEW.unclaimed := true;
		ELSIF NEW.unclaimed THEN
			NEW.invited_at := NEW.created_at;
		END IF;
	ELSIF NEW.invited_at IS DISTINCT FROM OLD.invited_at THEN
		NEW.unclaimed := NEW.invited_at IS NOT NULL;
	ELSIF NEW.unclaimed IS DISTINCT FROM OLD.unclaimed THEN
		NEW.invited_at := CASE WHEN NEW.unclaimed THEN NEW.created_at END;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "users_sync_unclaimed" BEFORE INSERT OR UPDATE OF invited_at, unclaimed ON "exagram"."users"
	FOR EACH ROW EXECUTE FUNCTION "exagram".users_sync_unclaimed();

CREATE FUNCTION "exagram".memberships_legacy_mirror() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM "exagram".copy_legacy_home(CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END);
	RETURN NULL;
END;
$$;

CREATE TRIGGER "memberships_legacy_mirror" AFTER INSERT OR UPDATE OR DELETE ON "exagram"."memberships"
	FOR EACH ROW EXECUTE FUNCTION "exagram".memberships_legacy_mirror();

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

CREATE FUNCTION "exagram".default_workspace_from_user() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.workspace_id IS NULL THEN
		SELECT u.workspace_id INTO NEW.workspace_id FROM "exagram"."users" u WHERE u.id = NEW.user_id;
	END IF;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "sessions_default_workspace" BEFORE INSERT ON "exagram"."sessions"
	FOR EACH ROW EXECUTE FUNCTION "exagram".default_workspace_from_user();
CREATE TRIGGER "connections_default_workspace" BEFORE INSERT ON "exagram"."connections"
	FOR EACH ROW EXECUTE FUNCTION "exagram".default_workspace_from_user();

CREATE OR REPLACE FUNCTION "exagram".invite_usable(inviter UUID, invite_role TEXT, invite_via TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT "exagram".invite_usable(
		inviter, (SELECT u.workspace_id FROM "exagram"."users" u WHERE u.id = inviter), invite_role, invite_via
	)
$$;

COMMIT;
