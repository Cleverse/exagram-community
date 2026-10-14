BEGIN;

-- Live updates: every write that changes what an open page shows sends one small
-- "something changed" notice on the exagram_changes channel. NOTIFY is only delivered on commit, so
-- a rolled-back write stays silent, and a trigger catches every writer: the api, the SQL functions
-- and the worker alike. The payload is ChangeNoticeSchema in change-feed.port.ts: ids and a topic,
-- never a title, a body or a Link token. The api re-checks reach before it forwards anything.
--
-- u names the users to reach directly, for the cases where reaches_artifact is already false by
-- the time the api reads it (a removed Artifact, a lost Grant). l names the Links a change ends.
CREATE FUNCTION "exagram".notify_change(
	p_workspace_id uuid,
	p_artifact_id  uuid,
	p_project_id   uuid,
	p_topic        text,
	p_users        uuid[] DEFAULT NULL,
	p_links        uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_payload text;
  v_from    int;
BEGIN
  -- A bulk job (the Synogram migration) sets this, stays quiet, and sends one resync at the end.
  -- A cascade from a row already gone leaves no workspace to address.
  IF p_workspace_id IS NULL OR current_setting('exagram.suppress_notify', true) = 'on' THEN
    RETURN;
  END IF;

  v_payload := json_build_object(
    'w', p_workspace_id, 'a', p_artifact_id, 'p', p_project_id, 't', p_topic, 'u', p_users, 'l', p_links
  )::text;

  -- pg_notify refuses anything at or past 8000 bytes, and an error would roll the write back. Too
  -- many users degrade to a workspace resync that still names the Links. Too many Links as well go
  -- out first as slices of the original notice with no users, then the resync without them.
  IF octet_length(v_payload) > 7500 THEN
    v_payload := json_build_object(
      'w', p_workspace_id, 'a', NULL, 'p', NULL, 't', 'resync', 'u', NULL, 'l', p_links
    )::text;

    IF octet_length(v_payload) > 7500 THEN
      FOR v_from IN 1 .. cardinality(p_links) BY 150 LOOP
        PERFORM pg_notify('exagram_changes', json_build_object(
          'w', p_workspace_id, 'a', p_artifact_id, 'p', p_project_id, 't', p_topic,
          'u', NULL, 'l', p_links[v_from : v_from + 149]
        )::text);
      END LOOP;
      v_payload := json_build_object(
        'w', p_workspace_id, 'a', NULL, 'p', NULL, 't', 'resync', 'u', NULL, 'l', NULL
      )::text;
    END IF;
  END IF;

  -- Postgres folds identical payloads sent within one transaction into one notice. Harmless: each is
  -- only a signal to refetch.
  PERFORM pg_notify('exagram_changes', v_payload);
END $$;

-- Who reaches an Artifact with this owner and Project: reaches_artifact's rules, on values a trigger
-- passes from OLD or NEW, so the set can be taken as the row stood before a change as well as after.
CREATE FUNCTION "exagram".reach_set(p_artifact_id uuid, p_owner_id uuid, p_project_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
AS $$
	SELECT array_agg(DISTINCT x.user_id ORDER BY x.user_id)
	FROM (
		SELECT COALESCE(p.owner_id, p_owner_id) AS user_id
		FROM (SELECT 1) one
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		UNION
		SELECT g.grantee_id
		FROM "exagram"."grants" g
		LEFT JOIN "exagram"."projects" p ON p.id = p_project_id
		WHERE g.artifact_id = p_artifact_id
		   OR g.project_id IN (p.id, p.parent_project_id)
	) x
$$;

-- One function for every artifacts trigger; TG_ARGV[0] is the topic the trigger's WHEN chose.
CREATE FUNCTION "exagram".artifacts_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_users uuid[];
  v_links uuid[];
BEGIN
  IF TG_ARGV[0] = 'removed' THEN
    -- After this row, reaches_artifact is false for everyone, so the audience is worked out here,
    -- from OLD: the Artifact as it stood just before.
    v_users := "exagram".reach_set(OLD.id, OLD.owner_id, OLD.project_id);

    -- Every Link a page may still be showing. An exhausted Link counts: max_views only stops new
    -- opens, so a page that claimed its view earlier is still open.
    SELECT array_agg(l.id ORDER BY l.id)
      INTO v_links
      FROM "exagram"."links" l
     WHERE l.artifact_id = OLD.id
       AND l.revoked_at IS NULL
       AND l.expires_at > now();
  ELSIF TG_OP = 'UPDATE' AND TG_ARGV[0] = 'artifact' AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
    -- A move: everyone who reached it before or reaches it now, so those who lost it hear too.
    SELECT array_agg(DISTINCT x.user_id ORDER BY x.user_id)
      INTO v_users
      FROM unnest(
        "exagram".reach_set(OLD.id, OLD.owner_id, OLD.project_id)
        || "exagram".reach_set(NEW.id, NEW.owner_id, NEW.project_id)
      ) AS x(user_id);
  END IF;

  PERFORM "exagram".notify_change(NEW.workspace_id, NEW.id, NEW.project_id, TG_ARGV[0], v_users, v_links);
  RETURN NULL;
END $$;

CREATE TRIGGER "artifacts_notify_insert"
	AFTER INSERT ON "exagram"."artifacts"
	FOR EACH ROW EXECUTE FUNCTION "exagram".artifacts_notify('artifact');

CREATE TRIGGER "artifacts_notify_current"
	AFTER UPDATE OF current_revision_id ON "exagram"."artifacts"
	FOR EACH ROW
	WHEN (OLD.current_revision_id IS DISTINCT FROM NEW.current_revision_id)
	EXECUTE FUNCTION "exagram".artifacts_notify('current');

-- A restore counts as an Artifact change: it is reachable again, so the api's reach check finds its
-- audience after commit. A move names its audience itself (artifacts_notify).
CREATE TRIGGER "artifacts_notify_artifact"
	AFTER UPDATE ON "exagram"."artifacts"
	FOR EACH ROW
	WHEN (
		OLD.title IS DISTINCT FROM NEW.title
		OR OLD.description IS DISTINCT FROM NEW.description
		OR OLD.project_id IS DISTINCT FROM NEW.project_id
		OR OLD.publish_policy IS DISTINCT FROM NEW.publish_policy
		OR OLD.redaction IS DISTINCT FROM NEW.redaction
		OR OLD.general_access IS DISTINCT FROM NEW.general_access
		OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
	)
	EXECUTE FUNCTION "exagram".artifacts_notify('artifact');

CREATE TRIGGER "artifacts_notify_removed"
	AFTER UPDATE OF deleted_at ON "exagram"."artifacts"
	FOR EACH ROW
	WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
	EXECUTE FUNCTION "exagram".artifacts_notify('removed');

-- Redaction and parse state live on the revisions row itself (000002, 000011), not in a table of
-- their own. A finished parse moves extraction_status, which revisions.list carries, so it is a
-- `revisions` change; a finished redaction moves redaction_status.
CREATE FUNCTION "exagram".revisions_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "exagram".notify_change(a.workspace_id, a.id, a.project_id, TG_ARGV[0])
     FROM "exagram"."artifacts" a
    WHERE a.id = NEW.artifact_id;
  RETURN NULL;
END $$;

CREATE TRIGGER "revisions_notify_insert"
	AFTER INSERT ON "exagram"."revisions"
	FOR EACH ROW EXECUTE FUNCTION "exagram".revisions_notify('revisions');

CREATE TRIGGER "revisions_notify_status"
	AFTER UPDATE ON "exagram"."revisions"
	FOR EACH ROW
	WHEN (
		OLD.status IS DISTINCT FROM NEW.status
		OR OLD.extraction_status IS DISTINCT FROM NEW.extraction_status
	)
	EXECUTE FUNCTION "exagram".revisions_notify('revisions');

CREATE TRIGGER "revisions_notify_redaction"
	AFTER UPDATE OF redaction_status ON "exagram"."revisions"
	FOR EACH ROW
	WHEN (OLD.redaction_status IS DISTINCT FROM NEW.redaction_status)
	EXECUTE FUNCTION "exagram".revisions_notify('redaction');

-- A Grant change goes to its grantee only, and is addressed to the grantee's workspace because that
-- is where their stream subscribes. The grantee's users row also survives a cascade from a deleted
-- Project, where the Project row is already gone. A Project Grant names no Artifact.
CREATE FUNCTION "exagram".grants_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_row        "exagram"."grants"%ROWTYPE;
  v_project_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  IF v_row.artifact_id IS NOT NULL THEN
    SELECT a.project_id INTO v_project_id FROM "exagram"."artifacts" a WHERE a.id = v_row.artifact_id;
  ELSE
    v_project_id := v_row.project_id;
  END IF;

  PERFORM "exagram".notify_change(u.workspace_id, v_row.artifact_id, v_project_id, 'reach', ARRAY[v_row.grantee_id])
     FROM "exagram"."users" u
    WHERE u.id = v_row.grantee_id;
  RETURN NULL;
END $$;

CREATE TRIGGER "grants_notify_insert_delete"
	AFTER INSERT OR DELETE ON "exagram"."grants"
	FOR EACH ROW EXECUTE FUNCTION "exagram".grants_notify();

-- A new role or a new pin both change what the grantee is served.
CREATE TRIGGER "grants_notify_update"
	AFTER UPDATE OF role, pinned_revision_id ON "exagram"."grants"
	FOR EACH ROW
	WHEN (
		OLD.role IS DISTINCT FROM NEW.role
		OR OLD.pinned_revision_id IS DISTINCT FROM NEW.pinned_revision_id
	)
	EXECUTE FUNCTION "exagram".grants_notify();

-- Projects are hard-deleted (DeleteProject), so a DELETE stands in for deleted_at.
CREATE FUNCTION "exagram".projects_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM "exagram".notify_change(OLD.workspace_id, NULL, OLD.id, 'project');
  ELSE
    PERFORM "exagram".notify_change(NEW.workspace_id, NULL, NEW.id, 'project');
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "projects_notify_insert_delete"
	AFTER INSERT OR DELETE ON "exagram"."projects"
	FOR EACH ROW EXECUTE FUNCTION "exagram".projects_notify();

CREATE TRIGGER "projects_notify_update"
	AFTER UPDATE ON "exagram"."projects"
	FOR EACH ROW
	WHEN (
		OLD.name IS DISTINCT FROM NEW.name
		OR OLD.parent_project_id IS DISTINCT FROM NEW.parent_project_id
		OR OLD.redaction IS DISTINCT FROM NEW.redaction
		OR OLD.publish_policy IS DISTINCT FROM NEW.publish_policy
		OR OLD.link_preview IS DISTINCT FROM NEW.link_preview
	)
	EXECUTE FUNCTION "exagram".projects_notify();

-- A comment hangs off a Revision; the notice names that Revision's Artifact.
CREATE FUNCTION "exagram".comments_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_revision_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_revision_id := OLD.revision_id;
  ELSE
    v_revision_id := NEW.revision_id;
  END IF;

  PERFORM "exagram".notify_change(a.workspace_id, a.id, a.project_id, 'comments')
     FROM "exagram"."revisions" r
     JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
    WHERE r.id = v_revision_id;
  RETURN NULL;
END $$;

CREATE TRIGGER "comments_notify"
	AFTER INSERT OR UPDATE OR DELETE ON "exagram"."comments"
	FOR EACH ROW EXECUTE FUNCTION "exagram".comments_notify();

-- A revoked Link: the open Link page hides its content. Ids only, never the token.
CREATE FUNCTION "exagram".links_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "exagram".notify_change(a.workspace_id, a.id, a.project_id, 'link', NULL, ARRAY[NEW.id])
     FROM "exagram"."artifacts" a
    WHERE a.id = NEW.artifact_id;
  RETURN NULL;
END $$;

CREATE TRIGGER "links_notify_revoked"
	AFTER UPDATE OF revoked_at ON "exagram"."links"
	FOR EACH ROW
	WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
	EXECUTE FUNCTION "exagram".links_notify();

COMMIT;
