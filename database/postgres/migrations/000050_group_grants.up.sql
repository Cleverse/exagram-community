BEGIN;

SET LOCAL lock_timeout = '5s';
-- Lock the view before its tables, the order a read of reaching_grants takes them; LOCK on a view also locks its tables.
LOCK TABLE "exagram"."reaching_grants", "exagram"."grants" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "exagram"."groups", "exagram"."group_members" IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "exagram"."grants"
	ALTER COLUMN "grantee_id" DROP NOT NULL,
	ADD COLUMN "group_id" UUID REFERENCES "exagram"."groups"("id") ON DELETE CASCADE,
	ADD CONSTRAINT "grants_grantee_xor" CHECK (("grantee_id" IS NULL) <> ("group_id" IS NULL)),
	ADD CONSTRAINT "grants_group_never_dormant" CHECK ("group_id" IS NULL OR NOT "dormant");

CREATE UNIQUE INDEX "grants_artifact_group_key"
	ON "exagram"."grants" ("artifact_id", "group_id") WHERE "artifact_id" IS NOT NULL AND "group_id" IS NOT NULL;
CREATE UNIQUE INDEX "grants_project_group_key"
	ON "exagram"."grants" ("project_id", "group_id") WHERE "project_id" IS NOT NULL AND "group_id" IS NOT NULL;
CREATE INDEX "grants_group_id_idx" ON "exagram"."grants" ("group_id") WHERE "group_id" IS NOT NULL;

CREATE FUNCTION "exagram".share_eligible(p_user UUID, p_workspace UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1 FROM "exagram"."users" u
		WHERE u.id = p_user
		  AND (
			EXISTS (
				SELECT 1 FROM "exagram"."share_allowed_emails" e
				WHERE e.workspace_id = p_workspace AND e.email = lower(btrim(u.email::TEXT))
			)
		  )
		  AND (
			EXISTS (
				SELECT 1 FROM "exagram"."user_identities" i
				WHERE i.user_id = u.id AND i.provider = 'google' AND lower(i.email::TEXT) = lower(btrim(u.email::TEXT))
			)
			OR u.password_hash = '!exagram:google-claim-required:v1!'
		  )
	)
$$;

CREATE FUNCTION "exagram".group_grant_reaches(p_group UUID, p_user UUID, p_artifact UUID, p_project UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT EXISTS (
		SELECT 1
		FROM "exagram"."groups" grp
		JOIN "exagram"."group_members" gm ON gm.group_id = grp.id AND gm.user_id = p_user
		JOIN "exagram"."workspaces" w ON w.id = grp.workspace_id
		LEFT JOIN "exagram"."artifacts" a ON a.id = p_artifact
		LEFT JOIN "exagram"."projects" p ON p.id = p_project
		WHERE grp.id = p_group
		  AND "exagram".live_member(p_user, grp.workspace_id)
		  AND (
			NOT (w.restricted_shares AND COALESCE(a.restricted_shares, p.restricted_shares, true))
			OR "exagram".share_eligible(p_user, grp.workspace_id)
		  )
	)
$$;

CREATE FUNCTION "exagram".group_member_count(p_group UUID) RETURNS INT
LANGUAGE sql STABLE AS $$
	SELECT count(*)::INT
	FROM "exagram"."group_members" gm
	JOIN "exagram"."groups" grp ON grp.id = gm.group_id
	WHERE gm.group_id = p_group AND "exagram".live_member(gm.user_id, grp.workspace_id)
$$;

DROP VIEW "exagram"."reaching_grants";
CREATE VIEW "exagram"."reaching_grants" AS
	SELECT g.id, g.artifact_id, g.project_id, g.grantee_id, g.role, g.pinned_revision_id, g.created_by, g.created_at,
		g.shared_with_email, g.source_shared_with_email, g.source_role, g.dormant, g.woken_at, g.group_id
	FROM "exagram"."grants" g
	WHERE g.grantee_id IS NOT NULL AND NOT g.dormant
	UNION ALL
	SELECT g.id, g.artifact_id, g.project_id, gm.user_id, g.role, g.pinned_revision_id, g.created_by, g.created_at,
		g.shared_with_email, g.source_shared_with_email, g.source_role, g.dormant, g.woken_at, g.group_id
	FROM "exagram"."grants" g
	JOIN "exagram"."group_members" gm ON gm.group_id = g.group_id
	WHERE "exagram".group_grant_reaches(g.group_id, gm.user_id, g.artifact_id, g.project_id);

CREATE OR REPLACE FUNCTION "exagram".reach_rows(p_user_id UUID)
RETURNS TABLE(artifact_id UUID, revision_id UUID, access TEXT, src_rank INTEGER, pinned BOOLEAN)
LANGUAGE sql STABLE AS $function$
	WITH owned AS (
		SELECT
			a.id AS artifact_id,
			a.current_revision_id AS revision_id,
			'owner'::TEXT AS access,
			0 AS src_rank,
			false AS pinned
		FROM "exagram"."artifacts" a
		LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
		WHERE a.deleted_at IS NULL
		  -- artifact_owner's rule (000005), written as a join so the scan uses the Project once, not once per Artifact.
		  AND COALESCE(p.owner_id, a.owner_id) = p_user_id
	),
	granted_direct AS (
		SELECT
			a.id AS artifact_id,
			COALESCE(g.pinned_revision_id, a.current_revision_id) AS revision_id,
			g.role AS access,
			CASE WHEN g.group_id IS NULL THEN 1 ELSE 2 END AS src_rank,
			g.pinned_revision_id IS NOT NULL AS pinned
		FROM "exagram"."reaching_grants" g
		JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		WHERE g.grantee_id = p_user_id AND g.artifact_id IS NOT NULL AND a.deleted_at IS NULL
	),
	granted_project AS (
		SELECT
			a.id AS artifact_id,
			COALESCE(g.pinned_revision_id, a.current_revision_id) AS revision_id,
			g.role AS access,
			CASE WHEN g.group_id IS NULL THEN 3 ELSE 4 END AS src_rank,
			g.pinned_revision_id IS NOT NULL AS pinned
		FROM "exagram"."reaching_grants" g
		JOIN "exagram"."projects" p ON p.id = g.project_id OR p.parent_project_id = g.project_id
		JOIN "exagram"."artifacts" a ON a.project_id = p.id
		WHERE g.grantee_id = p_user_id AND g.project_id IS NOT NULL AND a.deleted_at IS NULL
	)
	SELECT * FROM owned
	UNION ALL
	SELECT * FROM granted_direct
	UNION ALL
	SELECT * FROM granted_project
$function$;

-- Each branch names the item before reaching_grants expands a Group Grant, so only that item's Grants are expanded.
CREATE OR REPLACE FUNCTION "exagram".reach_set(p_artifact_id UUID, p_owner_id UUID, p_project_id UUID)
RETURNS UUID[]
LANGUAGE sql STABLE AS $function$
	SELECT array_agg(DISTINCT x.user_id ORDER BY x.user_id)
	FROM (
		SELECT COALESCE(p.owner_id, p_owner_id) AS user_id
		FROM (SELECT 1) one
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		UNION
		SELECT g.grantee_id FROM "exagram"."reaching_grants" g WHERE g.artifact_id = p_artifact_id
		UNION
		SELECT g.grantee_id FROM "exagram"."reaching_grants" g WHERE g.project_id = p_project_id
		UNION
		SELECT g.grantee_id
		FROM "exagram"."projects" p
		JOIN "exagram"."reaching_grants" g ON g.project_id = p.parent_project_id
		WHERE p.id = p_project_id
	) x
$function$;

CREATE OR REPLACE FUNCTION "exagram".user_project_role(p_user_id UUID, p_project_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE AS $function$
	SELECT CASE
		WHEN p.owner_id = p_user_id THEN 'owner'::TEXT
		ELSE (
			SELECT g.role
			FROM "exagram"."reaching_grants" g
			WHERE g.grantee_id = p_user_id
			  AND g.project_id IN (p.id, p.parent_project_id)
			ORDER BY g.group_id IS NOT NULL, CASE g.role WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END
			LIMIT 1
		)
	END
	FROM "exagram"."projects" p
	WHERE p.id = p_project_id
$function$;

-- user_project_role's ranking for the Grants on one Artifact itself, so every role check on an Artifact Grant ranks alike.
CREATE FUNCTION "exagram".user_artifact_grant_role(p_user_id UUID, p_artifact_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE AS $function$
	SELECT g.role
	FROM "exagram"."reaching_grants" g
	WHERE g.grantee_id = p_user_id AND g.artifact_id = p_artifact_id
	ORDER BY g.group_id IS NOT NULL, CASE g.role WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END
	LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION "exagram".connection_can_write_artifact(p_connection_id UUID, p_artifact_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
	SELECT COALESCE((
		SELECT rr.access IN ('owner', 'edit', 'collaborate')
		FROM "exagram"."connections" c, "exagram".reach_rows(c.user_id) rr
		WHERE c.id = p_connection_id
		  AND c.revoked_at IS NULL
		  AND rr.artifact_id = p_artifact_id
		  AND EXISTS (
			SELECT 1 FROM "exagram"."artifacts" a
			WHERE a.id = p_artifact_id AND "exagram".connection_covers_workspace(c.id, a.workspace_id)
		  )
		ORDER BY rr.src_rank, CASE rr.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END, rr.pinned DESC
		LIMIT 1
	), false)
$$;

CREATE FUNCTION "exagram".group_grant_audience(p_group UUID, p_artifact UUID, p_project UUID) RETURNS UUID[]
LANGUAGE sql STABLE AS $$
	SELECT array_agg(gm.user_id ORDER BY gm.user_id)
	FROM "exagram"."group_members" gm
	WHERE gm.group_id = p_group AND "exagram".group_grant_reaches(p_group, gm.user_id, p_artifact, p_project)
$$;

CREATE OR REPLACE FUNCTION "exagram".grants_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_row          "exagram"."grants"%ROWTYPE;
  v_workspace_id uuid;
  v_project_id   uuid;
  v_users        uuid[];
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

  IF v_row.group_id IS NULL THEN
    v_users := ARRAY[v_row.grantee_id];
  ELSE
    v_users := "exagram".group_grant_audience(v_row.group_id, v_row.artifact_id, v_row.project_id);
  END IF;
  IF v_users IS NOT NULL THEN
    PERFORM "exagram".notify_change(v_workspace_id, v_row.artifact_id, v_project_id, 'reach', v_users);
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION "exagram".group_grants_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_group_id uuid;
  v_user_id  uuid;
BEGIN
  IF TG_TABLE_NAME = 'groups' THEN
    PERFORM "exagram".notify_change(OLD.workspace_id, g.artifact_id, COALESCE(a.project_id, g.project_id), 'reach', m.users)
       FROM "exagram"."grants" g
       LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
       CROSS JOIN LATERAL (SELECT "exagram".group_grant_audience(g.group_id, g.artifact_id, g.project_id) AS users) m
      WHERE g.group_id = OLD.id AND m.users IS NOT NULL;
    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_group_id := OLD.group_id;
    v_user_id := OLD.user_id;
  ELSE
    v_group_id := NEW.group_id;
    v_user_id := NEW.user_id;
  END IF;

  PERFORM "exagram".notify_change(grp.workspace_id, g.artifact_id, COALESCE(a.project_id, g.project_id), 'reach', ARRAY[v_user_id])
     FROM "exagram"."grants" g
     JOIN "exagram"."groups" grp ON grp.id = g.group_id
     LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
    WHERE g.group_id = v_group_id
      AND "exagram".group_grant_reaches(g.group_id, v_user_id, g.artifact_id, g.project_id);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "groups_notify_delete"
	BEFORE DELETE ON "exagram"."groups"
	FOR EACH ROW EXECUTE FUNCTION "exagram".group_grants_notify();

CREATE TRIGGER "group_members_notify_insert"
	AFTER INSERT ON "exagram"."group_members"
	FOR EACH ROW EXECUTE FUNCTION "exagram".group_grants_notify();

CREATE TRIGGER "group_members_notify_delete"
	BEFORE DELETE ON "exagram"."group_members"
	FOR EACH ROW EXECUTE FUNCTION "exagram".group_grants_notify();

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
	IF NEW.group_id IS NOT NULL THEN
		IF NOT EXISTS (
			SELECT 1 FROM exagram.groups WHERE id = NEW.group_id AND workspace_id = target_workspace
		) THEN
			RAISE EXCEPTION 'Group grant names a group outside the item workspace'
				USING ERRCODE = '23514';
		END IF;
		NEW.shared_with_email := NULL;
		RETURN NEW;
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
	IF NOT exagram.share_eligible(NEW.grantee_id, target_workspace) THEN
		RAISE EXCEPTION 'Restricted Shares grantee email is outside the allowlist'
			USING ERRCODE = '23514';
	END IF;
	NEW.shared_with_email := target_email;
	RETURN NEW;
END;
$$;

DROP TRIGGER "check_share_target" ON "exagram"."grants";
CREATE TRIGGER "check_share_target"
	BEFORE INSERT OR UPDATE OF artifact_id, project_id, grantee_id, group_id, shared_with_email ON "exagram"."grants"
	FOR EACH ROW EXECUTE FUNCTION "exagram".check_share_target();

COMMIT;
