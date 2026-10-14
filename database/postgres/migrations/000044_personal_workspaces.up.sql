BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."workspaces", "exagram"."memberships",
	"exagram"."artifacts", "exagram"."projects", "exagram"."revisions", "exagram"."workspace_invites",
	"exagram"."join_requests", "exagram"."share_allowed_emails", "exagram"."workspace_org_domains",
	"exagram"."user_identities"
	IN EXCLUSIVE MODE;
-- Adding a column needs ACCESS EXCLUSIVE; taking it here rather than upgrading later cannot deadlock with a reader.
LOCK TABLE "exagram"."users", "exagram"."grants", "exagram"."password_resets", "exagram"."connections" IN ACCESS EXCLUSIVE MODE;

-- The one place a Personal Workspace's settings are written; sign-up passes no owner and sets it once the user exists.
CREATE FUNCTION "exagram".create_personal_workspace(p_owner UUID) RETURNS UUID
LANGUAGE sql AS $$
	INSERT INTO "exagram"."workspaces"
		(name, kind, owner_id, redaction, default_share_role, join_approval, member_invites, link_preview)
	VALUES ('Personal', 'personal', p_owner, 'off', 'view', 'admin', false, 'generic')
	RETURNING id
$$;

CREATE FUNCTION "exagram".ensure_personal_workspace(p_user UUID) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
	personal UUID;
	created UUID;
BEGIN
	SELECT m.workspace_id INTO personal FROM "exagram"."memberships" m
	WHERE m.user_id = p_user AND m.kind = 'personal';
	IF personal IS NOT NULL THEN
		RETURN personal;
	END IF;
	created := "exagram".create_personal_workspace(p_user);
	-- A concurrent ensure for the same person waits on the unique index here; the loser drops its own Workspace.
	INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, joined_at)
	VALUES (p_user, created, 'personal', 'admin', now())
	ON CONFLICT (user_id) WHERE kind = 'personal' DO NOTHING
	RETURNING workspace_id INTO personal;
	IF personal IS NULL THEN
		DELETE FROM "exagram"."workspaces" WHERE id = created;
		SELECT m.workspace_id INTO personal FROM "exagram"."memberships" m
		WHERE m.user_id = p_user AND m.kind = 'personal';
	END IF;
	RETURN personal;
END;
$$;

-- The live Team a person belongs to, if any; liveness is live_member's.
CREATE FUNCTION "exagram".live_team_of(p_user UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
	SELECT m.workspace_id FROM "exagram"."memberships" m
	WHERE m.user_id = p_user AND m.kind = 'team' AND "exagram".live_member(m.user_id, m.workspace_id)
$$;

-- A row only a share by email made: unclaimed, and a member of no Workspace, not even invited.
CREATE FUNCTION "exagram".bare_account(p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		WHERE u.id = p_user AND u.invited_at IS NOT NULL
		  AND NOT EXISTS (SELECT 1 FROM "exagram"."memberships" m WHERE m.user_id = u.id)
	)
$$;

-- An account someone had claimed before 000044 counts as proven: shares to it stay live, accepting that a squatter
-- from before 000044 keeps receiving them. Rows claimed or made later start false and never gain it,
-- unless an operator runs this down and up again, which grandfathers every account claimed by then.
ALTER TABLE "exagram"."users" ADD COLUMN "email_proven_legacy" BOOLEAN NOT NULL DEFAULT false;
UPDATE "exagram"."users" SET email_proven_legacy = true
WHERE invited_at IS NULL AND password_hash IS DISTINCT FROM '!exagram:google-claim-required:v1!';

-- Whoever proved they read mail at the account's address (a Google identity for it, or a confirmed Notification Email),
-- or held it before 000044.
CREATE FUNCTION "exagram".email_proven(p_user UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT "exagram".notification_email_verified(p_user)
		OR EXISTS (SELECT 1 FROM "exagram"."users" u WHERE u.id = p_user AND u.email_proven_legacy)
$$;

-- A share by email to an account nobody had proven the email of, unless the target's own Workspace vouched for it (the
-- grantee is its live member). A dormant Grant reaches nobody; its sharer sees it as pending.
ALTER TABLE "exagram"."grants" ADD COLUMN "dormant" BOOLEAN NOT NULL DEFAULT false;
-- When a dormant Grant woke, which is when it first reached anyone; notifications date it by this.
ALTER TABLE "exagram"."grants" ADD COLUMN "woken_at" TIMESTAMPTZ;
CREATE INDEX "grants_dormant_grantee_idx" ON "exagram"."grants" ("grantee_id") WHERE "dormant";

-- Wakes every dormant Grant of the person that is now vouched for: all of them once the email is proven, else the ones
-- in a Workspace they are a live member of. Idempotent, so each sign-in retries one that failed.
CREATE FUNCTION "exagram".wake_grants(p_user UUID) RETURNS INT
LANGUAGE sql AS $$
	WITH woken AS (
		UPDATE "exagram"."grants" g SET dormant = false, woken_at = now()
		WHERE g.grantee_id = p_user AND g.dormant
		  AND (
			"exagram".email_proven(p_user)
			OR "exagram".live_member(p_user, COALESCE(
				(SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = g.artifact_id),
				(SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = g.project_id)
			))
		  )
		RETURNING 1
	)
	SELECT count(*)::INT FROM woken
$$;

-- A dormant Grant reaches nobody, so its insert, role or pin change and removal tell its grantee nothing; its wake does.
CREATE OR REPLACE FUNCTION "exagram".grants_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_row          "exagram"."grants"%ROWTYPE;
  v_workspace_id uuid;
  v_project_id   uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;
  IF v_row.dormant THEN
    RETURN NULL;
  END IF;

  IF v_row.artifact_id IS NOT NULL THEN
    SELECT a.workspace_id, a.project_id INTO v_workspace_id, v_project_id
      FROM "exagram"."artifacts" a WHERE a.id = v_row.artifact_id;
  ELSE
    v_project_id := v_row.project_id;
    SELECT p.workspace_id INTO v_workspace_id FROM "exagram"."projects" p WHERE p.id = v_row.project_id;
  END IF;

  PERFORM "exagram".notify_change(v_workspace_id, v_row.artifact_id, v_project_id, 'reach', ARRAY[v_row.grantee_id]);
  RETURN NULL;
END $$;

DROP TRIGGER "grants_notify_update" ON "exagram"."grants";
CREATE TRIGGER "grants_notify_update"
	AFTER UPDATE OF role, pinned_revision_id, dormant ON "exagram"."grants"
	FOR EACH ROW
	WHEN (OLD.role IS DISTINCT FROM NEW.role OR OLD.pinned_revision_id IS DISTINCT FROM NEW.pinned_revision_id
		OR OLD.dormant IS DISTINCT FROM NEW.dormant)
	EXECUTE FUNCTION "exagram".grants_notify();

CREATE OR REPLACE FUNCTION "exagram".reach_rows(p_user_id UUID)
RETURNS TABLE(artifact_id UUID, revision_id UUID, access TEXT, src_rank INTEGER, pinned BOOLEAN)
LANGUAGE sql STABLE AS $function$
	-- Rule 1: everything the user owns, directly or through a project they own.
	WITH owned AS (
		SELECT
			a.id AS artifact_id,
			a.current_revision_id AS revision_id,
			'owner'::TEXT AS access,
			0 AS src_rank,
			false AS pinned
		FROM "exagram"."artifacts" a
		WHERE a.deleted_at IS NULL
		  AND "exagram".artifact_owner(a.id) = p_user_id
	),
	-- Rule 2a: a grant on the artifact itself.
	granted_direct AS (
		SELECT
			a.id AS artifact_id,
			COALESCE(g.pinned_revision_id, a.current_revision_id) AS revision_id,
			g.role AS access,
			1 AS src_rank,
			g.pinned_revision_id IS NOT NULL AS pinned
		FROM "exagram"."grants" g
		JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		WHERE g.grantee_id = p_user_id AND g.artifact_id IS NOT NULL AND NOT g.dormant AND a.deleted_at IS NULL
	),
	-- Rule 2b: a grant on a project covers the project and its one level of children.
	granted_project AS (
		SELECT
			a.id AS artifact_id,
			COALESCE(g.pinned_revision_id, a.current_revision_id) AS revision_id,
			g.role AS access,
			2 AS src_rank,
			g.pinned_revision_id IS NOT NULL AS pinned
		FROM "exagram"."grants" g
		JOIN "exagram"."projects" p ON p.id = g.project_id
		JOIN "exagram"."artifacts" a
			ON a.project_id = p.id
			OR a.project_id IN (
				SELECT cp.id FROM "exagram"."projects" cp WHERE cp.parent_project_id = p.id
			)
		WHERE g.grantee_id = p_user_id AND g.project_id IS NOT NULL AND NOT g.dormant AND a.deleted_at IS NULL
	)
	SELECT * FROM owned
	UNION ALL
	SELECT * FROM granted_direct
	UNION ALL
	SELECT * FROM granted_project
$function$;

CREATE OR REPLACE FUNCTION "exagram".reaches_artifact(p_user_id UUID, p_artifact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $function$
	SELECT EXISTS (
		SELECT 1
		FROM "exagram"."artifacts" a
		LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
		WHERE a.id = p_artifact_id
		  AND a.deleted_at IS NULL
		  AND (
			"exagram".artifact_owner(a.id) = p_user_id
			OR EXISTS (
				SELECT 1 FROM "exagram"."grants" g
				WHERE g.grantee_id = p_user_id AND NOT g.dormant
				  AND (g.artifact_id = a.id OR g.project_id IN (p.id, p.parent_project_id))
			)
		  )
	)
$function$;

CREATE OR REPLACE FUNCTION "exagram".user_project_role(p_user_id UUID, p_project_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE AS $function$
	SELECT CASE
		WHEN p.owner_id = p_user_id THEN 'owner'::TEXT
		ELSE (
			SELECT g.role
			FROM "exagram"."grants" g
			WHERE g.grantee_id = p_user_id AND NOT g.dormant
			  AND g.project_id IN (p.id, p.parent_project_id)
			ORDER BY CASE g.role WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END
			LIMIT 1
		)
	END
	FROM "exagram"."projects" p
	WHERE p.id = p_project_id
$function$;

CREATE OR REPLACE FUNCTION "exagram".reach_set(p_artifact_id UUID, p_owner_id UUID, p_project_id UUID)
RETURNS UUID[]
LANGUAGE sql STABLE AS $function$
	SELECT array_agg(DISTINCT x.user_id ORDER BY x.user_id)
	FROM (
		SELECT COALESCE(p.owner_id, p_owner_id) AS user_id
		FROM (SELECT 1) one
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		UNION
		SELECT g.grantee_id
		FROM "exagram"."grants" g
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		WHERE NOT g.dormant AND (g.artifact_id = p_artifact_id OR g.project_id IN (p.id, p.parent_project_id))
	) x
$function$;

-- Whoever becomes a live member of a Team holds a Personal Workspace too, whichever writer made them one: sign-up,
-- a claim, a join, the importer, a seed, or an API pod older than this migration.
CREATE FUNCTION "exagram".membership_went_live() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM "exagram".ensure_personal_workspace(NEW.user_id);
	RETURN NULL;
END;
$$;

-- Takes, in the order every writer of a person takes them, the locks a claim needs: the person's memberships, the
-- bare-account email lock the orphan sweep also takes, then the users row. False when the row is gone (the sweep took
-- it) or no longer unclaimed.
CREATE FUNCTION "exagram".lock_unclaimed_account(p_user UUID) RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
BEGIN
	PERFORM 1 FROM "exagram"."memberships" m WHERE m.user_id = p_user ORDER BY m.workspace_id FOR NO KEY UPDATE;
	PERFORM pg_advisory_xact_lock(hashtext('bare:' || lower(u.email::TEXT))) FROM "exagram"."users" u WHERE u.id = p_user;
	RETURN EXISTS (
		SELECT 1 FROM "exagram"."users" u WHERE u.id = p_user AND u.invited_at IS NOT NULL FOR NO KEY UPDATE
	);
END;
$$;

-- Turns a row someone shared with into an account at home in its own Personal Workspace: it leaves every Workspace
-- that only invited it, and its password becomes p_password_hash (null after a Google sign-in). It is dated by the
-- claim, so the account says nothing about when it was first shared with. Its Grants stay as they are; a password
-- caller then puts to sleep the ones nobody vouches for (SleepUnvouchedGrants). Null when the row is no longer
-- unclaimed or is not waiting for exactly this claim.
CREATE FUNCTION "exagram".claim_unclaimed_account(p_user UUID, p_name TEXT, p_password_hash TEXT) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
	claimed UUID;
	personal UUID;
BEGIN
	IF NOT "exagram".lock_unclaimed_account(p_user) THEN
		RETURN NULL;
	END IF;
	-- Before the users UPDATE, whose invited_at a trigger copies onto these memberships and would make live.
	-- A claim that then matches nothing returns null and every caller aborts its transaction.
	DELETE FROM "exagram"."memberships" m
	WHERE m.user_id = p_user AND m.invited_at IS NOT NULL AND m.removed_at IS NULL;
	UPDATE "exagram"."users" u
	SET invited_at = NULL, joined_at = now(), created_at = now(), password_hash = p_password_hash,
		name = CASE WHEN u.name = u.email::TEXT AND p_name IS NOT NULL THEN p_name ELSE u.name END
	WHERE u.id = p_user AND u.invited_at IS NOT NULL AND u.password_hash = '!exagram:google-claim-required:v1!'
	RETURNING u.id INTO claimed;
	IF claimed IS NULL THEN
		RETURN NULL;
	END IF;
	personal := "exagram".ensure_personal_workspace(p_user);
	UPDATE "exagram"."users" SET workspace_id = personal, is_admin = true WHERE id = p_user;
	RETURN claimed;
END;
$$;

-- An Admin's Reset Link would hand its maker the holder's Personal Workspace too, so it is refused for anyone who uses
-- Personal: a Personal file or folder, a Personal-bound Connection, or a share received from outside p_team, dormant
-- or not. It is refused too for anyone who proved their email by Google or mail, since its password would let the
-- maker in wherever that proof later reaches; that person recovers through it instead. An account grandfathered by
-- email_proven_legacy proved nothing and may have no other way back in, so it is not refused for that alone.
CREATE FUNCTION "exagram".admin_reset_refused(p_user UUID, p_team UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT "exagram".notification_email_verified(p_user) OR EXISTS (
		SELECT 1 FROM "exagram"."artifacts" a JOIN "exagram"."workspaces" w ON w.id = a.workspace_id
		WHERE a.owner_id = p_user AND w.kind = 'personal'
	) OR EXISTS (
		SELECT 1 FROM "exagram"."projects" p JOIN "exagram"."workspaces" w ON w.id = p.workspace_id
		WHERE p.owner_id = p_user AND w.kind = 'personal'
	) OR EXISTS (
		SELECT 1 FROM "exagram"."connections" c JOIN "exagram"."workspaces" w ON w.id = c.workspace_id
		WHERE c.user_id = p_user AND c.revoked_at IS NULL AND w.kind = 'personal'
	) OR EXISTS (
		SELECT 1 FROM "exagram"."grants" g
		LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
		WHERE g.grantee_id = p_user AND COALESCE(a.workspace_id, p.workspace_id) IS DISTINCT FROM p_team
	)
$$;

-- A Connection reaches shares from outside its Personal Workspace only when the person consented to that binding;
-- one bound to a Team that 000044 turned Personal keeps its old reach until they consent again.
ALTER TABLE "exagram"."connections" ADD COLUMN "covers_outside" BOOLEAN NOT NULL DEFAULT false;
UPDATE "exagram"."connections" SET covers_outside = true WHERE "exagram".is_personal(workspace_id);

CREATE FUNCTION "exagram".connection_binding_covers_outside() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	NEW.covers_outside := "exagram".is_personal(NEW.workspace_id);
	RETURN NEW;
END;
$$;

CREATE TRIGGER "connections_binding_covers_outside"
	BEFORE INSERT OR UPDATE OF workspace_id ON "exagram"."connections"
	FOR EACH ROW EXECUTE FUNCTION "exagram".connection_binding_covers_outside();

-- Which Workspaces a list in a session's (or Connection's) Workspace draws from: that one, and, for a Personal
-- Workspace, every Workspace the person is not a live member of, whose files reach them only by being shared. Lists
-- keep what the person owns to the session's own Workspace. A Workspace that cannot be named is never covered.
CREATE FUNCTION "exagram".principal_scope_covers(p_kind TEXT, p_id UUID, p_scope UUID, p_workspace UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT p_workspace IS NOT NULL AND (
		p_workspace = p_scope OR (
			"exagram".is_personal(p_scope)
			AND NOT "exagram".principal_live_member(p_kind, p_id, p_workspace)
			AND (p_kind <> 'connection' OR EXISTS (
				SELECT 1 FROM "exagram"."connections" c WHERE c.id = p_id AND c.covers_outside
			))
		)
	)
$$;

-- The binding rule goes through the same predicate, and so does its copy inside visible_artifacts.
CREATE OR REPLACE FUNCTION "exagram".connection_covers_workspace(p_connection_id UUID, p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
	SELECT EXISTS (
		SELECT 1
		FROM "exagram"."connections" c
		WHERE c."id" = p_connection_id
		  AND c."revoked_at" IS NULL
		  AND "exagram".live_member(c."user_id", c."workspace_id")
		  AND "exagram".principal_scope_covers('connection', c."id", c."workspace_id", p_workspace_id)
	)
$$;

CREATE OR REPLACE FUNCTION "exagram".visible_artifacts(p_kind TEXT, p_id UUID)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN)
LANGUAGE sql
STABLE
AS $$
	WITH principal_user AS (
		SELECT CASE
			WHEN p_kind = 'user' THEN p_id
			WHEN p_kind = 'connection' THEN (
				SELECT c.user_id
				FROM "exagram"."connections" c
				WHERE c.id = p_id AND c.revoked_at IS NULL
			)
		END AS user_id
	),
	connection_scope AS (
		SELECT c.id, c.user_id, c.folder_access, c.other_files_access, c.workspace_id, bound.kind AS workspace_kind,
			c.covers_outside
		FROM "exagram"."connections" c
		JOIN "exagram"."workspaces" bound ON bound.id = c.workspace_id
		WHERE p_kind = 'connection' AND c.id = p_id AND c.revoked_at IS NULL
		  AND "exagram".live_member(c.user_id, c.workspace_id)
	),
	member_workspaces AS (
		SELECT m.workspace_id
		FROM "exagram"."memberships" m
		JOIN connection_scope cs ON cs.user_id = m.user_id
		WHERE "exagram".live_member(m.user_id, m.workspace_id)
	),
	connection_project_rights AS (
		SELECT
			cs.id AS connection_id,
			p.id AS project_id,
			"exagram".user_project_role(cs.user_id, p.id) AS person_role,
			cs.folder_access,
			cs.other_files_access,
			self_entry.access AS self_access,
			CASE WHEN p.parent_project_id IS NOT NULL
				AND "exagram".user_project_role(cs.user_id, p.parent_project_id) IS NOT NULL
				THEN parent_entry.access END AS parent_access
		FROM connection_scope cs
		JOIN "exagram"."projects" p ON true
		LEFT JOIN "exagram"."connection_folders" self_entry
			ON self_entry.connection_id = cs.id AND self_entry.project_id = p.id
		LEFT JOIN "exagram"."connection_folders" parent_entry
			ON parent_entry.connection_id = cs.id AND parent_entry.project_id = p.parent_project_id
	),
	user_rows AS (
		SELECT rr.artifact_id, rr.revision_id, rr.access, rr.src_rank, rr.pinned
		FROM principal_user pu
		CROSS JOIN LATERAL "exagram".reach_rows(pu.user_id) rr
		LEFT JOIN "exagram"."artifacts" a ON a.id = rr.artifact_id
		LEFT JOIN connection_scope cs ON cs.id = p_id
		LEFT JOIN connection_project_rights cpr
			ON cpr.connection_id = p_id AND cpr.project_id = a.project_id
		WHERE pu.user_id IS NOT NULL
		  AND (rr.revision_id IS NOT NULL OR (p_kind = 'user' AND rr.access = 'owner'))
		  AND (p_kind = 'user' OR (
			(
				a.workspace_id = cs.workspace_id
				OR (cs.workspace_kind = 'personal' AND cs.covers_outside
					AND a.workspace_id NOT IN (SELECT workspace_id FROM member_workspaces))
			)
			AND CASE
				WHEN cs.folder_access = 'all' THEN true
				WHEN a.project_id IS NULL OR cpr.person_role IS NULL
					THEN cs.other_files_access = 'view'
				WHEN COALESCE(cpr.self_access, cpr.parent_access) IS NULL THEN false
				ELSE true
			END))
	),
	link_row AS (
		SELECT
			l.artifact_id,
			l.revision_id,
			'view'::TEXT AS access,
			3 AS src_rank,
			true AS pinned
		FROM "exagram"."links" l
		JOIN "exagram"."artifacts" a ON a.id = l.artifact_id
		WHERE p_kind = 'link'
		  AND l.id = p_id
		  AND l.revoked_at IS NULL
		  AND l.expires_at > now()
		  AND (l.max_views IS NULL OR l.views_used < l.max_views)
		  AND a.deleted_at IS NULL
	),
	all_rows AS (
		SELECT * FROM user_rows WHERE p_kind IN ('user', 'connection') AND access IS NOT NULL
		UNION ALL
		SELECT * FROM link_row
	)
	SELECT DISTINCT ON (r.artifact_id) r.artifact_id, r.revision_id, r.access, r.pinned
	FROM all_rows r
	ORDER BY r.artifact_id, r.src_rank,
		CASE r.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END, r.pinned DESC
$$;

CREATE TEMPORARY TABLE "solo" ON COMMIT DROP AS
SELECT w.id AS workspace_id, m.user_id
FROM "exagram"."workspaces" w
JOIN "exagram"."memberships" m ON m.workspace_id = w.id AND m.removed_at IS NULL AND m.invited_at IS NULL
WHERE w.kind = 'team'
  AND NOT w.restricted_shares
  AND w.redaction = 'off'
  AND NOT EXISTS (
	SELECT 1 FROM "exagram"."memberships" x
	WHERE x.workspace_id = w.id AND x.user_id <> m.user_id AND x.removed_at IS NULL
  )
  AND NOT EXISTS (SELECT 1 FROM "exagram"."memberships" p WHERE p.user_id = m.user_id AND p.kind = 'personal')
  AND NOT EXISTS (SELECT 1 FROM "exagram"."workspace_invites" i WHERE i.workspace_id = w.id AND i.expires_at > now())
  AND NOT EXISTS (SELECT 1 FROM "exagram"."join_requests" r WHERE r.workspace_id = w.id AND r.declined_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM "exagram"."workspace_org_domains" d WHERE d.workspace_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM "exagram"."share_allowed_emails" e WHERE e.workspace_id = w.id)
  AND NOT EXISTS (
	SELECT 1 FROM "exagram"."artifacts" a
	WHERE a.workspace_id = w.id AND (a.restricted_shares OR a.owner_id <> m.user_id OR a.redaction = 'on')
  )
  AND NOT EXISTS (
	SELECT 1 FROM "exagram"."projects" p
	WHERE p.workspace_id = w.id AND (p.restricted_shares OR p.owner_id <> m.user_id OR p.redaction = 'on')
  )
  AND NOT EXISTS (
	SELECT 1 FROM "exagram"."revisions" r JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	WHERE a.workspace_id = w.id AND r.status = 'pending'
  )
  AND NOT EXISTS (
	SELECT 1 FROM "exagram"."grants" g
	JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	WHERE a.workspace_id = w.id AND g.grantee_id <> m.user_id
  )
  AND NOT EXISTS (
	SELECT 1 FROM "exagram"."grants" g
	JOIN "exagram"."projects" p ON p.id = g.project_id
	WHERE p.workspace_id = w.id AND g.grantee_id <> m.user_id
  );

DELETE FROM "exagram"."memberships" m USING "solo" s
WHERE m.workspace_id = s.workspace_id AND m.user_id <> s.user_id;
DELETE FROM "exagram"."workspace_invites" i USING "solo" s WHERE i.workspace_id = s.workspace_id;
DELETE FROM "exagram"."join_requests" r USING "solo" s WHERE r.workspace_id = s.workspace_id;

UPDATE "exagram"."grants" g SET role = 'edit'
FROM "exagram"."artifacts" a, "solo" s
WHERE g.role = 'collaborate' AND a.id = g.artifact_id AND a.workspace_id = s.workspace_id;
UPDATE "exagram"."grants" g SET role = 'edit'
FROM "exagram"."projects" p, "solo" s
WHERE g.role = 'collaborate' AND p.id = g.project_id AND p.workspace_id = s.workspace_id;

-- With redaction off and nothing pending, these only clear settings a Personal Workspace has no use for.
UPDATE "exagram"."artifacts" a
SET general_access = CASE WHEN a.general_access = 'org' THEN 'restricted' ELSE a.general_access END,
	publish_policy = NULL, redaction = NULL
FROM "solo" s
WHERE a.workspace_id = s.workspace_id
  AND (a.general_access = 'org' OR a.publish_policy IS NOT NULL OR a.redaction IS NOT NULL);
UPDATE "exagram"."projects" p
SET publish_policy = 'auto', redaction = NULL, link_preview = 'generic'
FROM "solo" s
WHERE p.workspace_id = s.workspace_id
  AND (p.publish_policy <> 'auto' OR p.redaction IS NOT NULL OR p.link_preview <> 'generic');

UPDATE "exagram"."memberships" m SET role = 'admin'
FROM "solo" s WHERE m.workspace_id = s.workspace_id AND m.user_id = s.user_id AND m.role <> 'admin';
UPDATE "exagram"."users" u SET is_admin = true
FROM "solo" s WHERE u.id = s.user_id AND u.workspace_id = s.workspace_id AND NOT u.is_admin;

UPDATE "exagram"."workspaces" w
SET kind = 'personal', owner_id = s.user_id, redaction = 'off', default_share_role = 'view', join_approval = 'admin',
	member_invites = false, link_preview = 'generic', join_mode = 'invite', domain_link_enabled = false,
	seat_limit = NULL, restricted_shares = false
FROM "solo" s
WHERE w.id = s.workspace_id;

WITH claimed AS (
	SELECT DISTINCT m.user_id FROM "exagram"."memberships" m
	WHERE m.removed_at IS NULL AND m.invited_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM "exagram"."memberships" p WHERE p.user_id = m.user_id AND p.kind = 'personal')
), created AS (
	SELECT c.user_id, "exagram".create_personal_workspace(c.user_id) AS workspace_id FROM claimed c
)
INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, joined_at)
SELECT c.user_id, c.workspace_id, 'personal', 'admin', now() FROM created c;

CREATE TRIGGER "memberships_went_live"
	AFTER INSERT OR UPDATE OF invited_at, removed_at ON "exagram"."memberships"
	FOR EACH ROW WHEN (NEW.kind = 'team' AND NEW.invited_at IS NULL AND NEW.removed_at IS NULL)
	EXECUTE FUNCTION "exagram".membership_went_live();

-- A Reset Link an Admin makes belongs to the Workspace they made it in; its use checks their membership there.
ALTER TABLE "exagram"."password_resets"
	ADD COLUMN "workspace_id" UUID REFERENCES "exagram"."workspaces"("id") ON DELETE CASCADE;
UPDATE "exagram"."password_resets" r SET workspace_id = u.workspace_id
FROM "exagram"."users" u WHERE u.id = r.created_by;

COMMIT;
