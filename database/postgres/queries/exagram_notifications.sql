-- database/postgres/queries/exagram_notifications.sql
-- Notifications (ADR 0036, ADR 0040): metadata about what is new for a member, decided here per kind.
-- Never a comment body or Revision content, so listing serves nothing and writes no Ledger row. The one
-- text it carries is an Access Request's note, to that request's Owner, who already reads it in Activity.

-- name: GetNotificationPreferences :one
-- No row means the member never saved; the caller uses the defaults.
SELECT "access_requests", "pending_revisions", "grants", "comments", "decisions", "published", "connections", "recap",
       "revision_scope", "quiet_hours", to_char("quiet_from", 'HH24:MI') AS quiet_from, to_char("quiet_to", 'HH24:MI') AS quiet_to,
       "quiet_urgent"
FROM "exagram"."notification_preferences"
WHERE "user_id" = @user_id::uuid;

-- name: UpsertNotificationPreferences :one
INSERT INTO "exagram"."notification_preferences"
	("user_id", "access_requests", "pending_revisions", "grants", "comments", "decisions", "published", "connections",
	 "recap", "revision_scope", "quiet_hours", "quiet_from", "quiet_to", "quiet_urgent")
VALUES (
	@user_id::uuid,
	@access_requests::boolean,
	@pending_revisions::boolean,
	@grants::boolean,
	@comments::boolean,
	@decisions::boolean,
	@published::boolean,
	@connections::boolean,
	@recap::boolean,
	@revision_scope::text,
	@quiet_hours::boolean,
	CAST(@quiet_from::text AS time),
	CAST(@quiet_to::text AS time),
	@quiet_urgent::boolean
)
ON CONFLICT ("user_id") DO UPDATE SET
	"access_requests" = EXCLUDED."access_requests",
	"pending_revisions" = EXCLUDED."pending_revisions",
	"grants" = EXCLUDED."grants",
	"comments" = EXCLUDED."comments",
	"decisions" = EXCLUDED."decisions",
	"published" = EXCLUDED."published",
	"connections" = EXCLUDED."connections",
	"recap" = EXCLUDED."recap",
	"revision_scope" = EXCLUDED."revision_scope",
	"quiet_hours" = EXCLUDED."quiet_hours",
	"quiet_from" = EXCLUDED."quiet_from",
	"quiet_to" = EXCLUDED."quiet_to",
	"quiet_urgent" = EXCLUDED."quiet_urgent",
	"updated_at" = now()
RETURNING "access_requests", "pending_revisions", "grants", "comments", "decisions", "published", "connections", "recap",
          "revision_scope", "quiet_hours", to_char("quiet_from", 'HH24:MI') AS quiet_from,
          to_char("quiet_to", 'HH24:MI') AS quiet_to, "quiet_urgent";

-- name: ListNotificationMutedProjects :many
-- The member's muted folders that they still reach (ListVisibleProjects' rule); one they lost drops out.
SELECT m."project_id"
FROM "exagram"."notification_muted_projects" m
JOIN "exagram"."projects" p ON p.id = m.project_id
WHERE m.user_id = @user_id::uuid
  AND p.workspace_id = @workspace_id::uuid
  AND "exagram".user_project_role(@user_id::uuid, p.id) IS NOT NULL
ORDER BY m."project_id";

-- name: ClearNotificationMutedProjects :exec
DELETE FROM "exagram"."notification_muted_projects" m
USING "exagram"."projects" p
WHERE m."user_id" = @user_id::uuid AND p.id = m."project_id" AND p.workspace_id = @workspace_id::uuid;

-- name: MuteNotificationProjects :exec
-- Keeps only folders the member reaches; any other id, real or not, is dropped the same way.
INSERT INTO "exagram"."notification_muted_projects" ("user_id", "project_id")
SELECT @user_id::uuid, p.id
FROM "exagram"."projects" p
WHERE p.id = ANY(@project_ids::uuid[])
  AND p.workspace_id = @workspace_id::uuid
  AND "exagram".user_project_role(@user_id::uuid, p.id) IS NOT NULL
ON CONFLICT DO NOTHING;

-- name: ListNotificationsSince :many
-- The app feed: what is new for the member in the Workspace their session acts in, from not_before on, oldest
-- first, for the kinds whose flag is on and within the given revision scope. The caller passes the member's
-- Notification Preferences. A row belongs to the Workspace of its Artifact, folder or Connection, and one in
-- another Workspace is left out. ListNotificationEmailItems has the same body (a test keeps the two equal).
-- Muted folders are read here. Each kind reuses the predicate of the list it mirrors:
--   accessRequest   ListOpenAccessRequestsForOwner: open requests on live Artifacts the member owns.
--   pendingRevision pending_revisions(member) rows the member approves, except those the member wrote
--                   in person; one their own Connection wrote waits for them too (ADR 0022).
--   grant           Grants to the member by someone else, on an Artifact visible_artifacts returns, or on
--                   a folder in their Workspace (ListVisibleProjects). Not the Grant that granting the
--                   member's own Access Request made, when that request's decision is sent instead.
--                   Granting runs in one transaction, so the Grant's created_at equals the request's
--                   resolved_at.
--   comment         comments by someone else on the Revision visible_artifacts serves the member.
--   decision        an answer to the member: their Access Request granted, on an Artifact
--                   visible_artifacts serves them while the Grant it made still stands (outcome 'granted',
--                   named), or declined (outcome 'declined', the Artifact's id only: no title, no Owner); or
--                   a Revision they wrote, in person or through their own Connection, approved after it
--                   waited ('approved') or discarded ('discarded'), on an Artifact they still reach and
--                   someone else owns. A Revision published on arrival has approved_at = created_at
--                   (publish_on_upload) and is no answer.
--   published       an approved Revision by someone other than the member and their Connections, on an
--                   Artifact visible_artifacts serves the member unpinned, within their revision scope:
--                   'all' every such Artifact, 'member' one in a folder they own or hold a Grant on (or its
--                   parent) or one granted to them directly, 'mine' none.
--   connection      the member's own live Connection, created or last widened.
-- Muted folders, and their subfolders, drop every kind that names an Artifact or folder in them, except
-- the declined decision, which names neither.
-- An actor is named only where the member already sees that name in a list: the Artifact's Owner
-- (owner_name), a folder's Owner to someone who sees the folder (ListVisibleProjects' owner_name), for a
-- folder someone in member_names under ListVisibleProjects' own gate, or for an Artifact a grantee in
-- shared_with_names (GetVisibleArtifactRow). A published Revision's author is named when they are the
-- Artifact's Owner, an Editor or Collaborator of the file, or of its folder to a member who passes that
-- gate. Otherwise NULL.
-- not_before is a lower bound the usecase has already clamped to 7 days. A later page also passes the
-- previous page's last row as after_at and after_id, at full microsecond precision, and reads on from
-- strictly after it in (created_at, id) order, so rows sharing a timestamp are each returned once.
-- visible_artifacts runs only when a Grant to the member, a comment by someone else, a Revision
-- approved by someone else or a grant of the member's Access Request is new enough to matter; it
-- decides nothing beyond that.
WITH pref AS (
	SELECT @access_requests::boolean AS access_requests,
	       @pending_revisions::boolean AS pending_revisions,
	       @grants::boolean AS grants,
	       @comments::boolean AS comments,
	       @decisions::boolean AS decisions,
	       @published::boolean AS published,
	       @connections::boolean AS connections,
	       @revision_scope::text AS revision_scope
),
muted AS MATERIALIZED (
	SELECT p.id
	FROM "exagram"."notification_muted_projects" m
	JOIN "exagram"."projects" p ON m.project_id IN (p.id, p.parent_project_id)
	WHERE m.user_id = @user_id::uuid
),
visible AS MATERIALIZED (
	SELECT v.artifact_id, v.revision_id, v.pinned
	FROM "exagram"."visible_artifacts"('user', @user_id::uuid) v
	WHERE ((SELECT grants FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."grants" ng
	                    WHERE ng.grantee_id = @user_id::uuid
	                      AND ng.artifact_id IS NOT NULL
	                      AND ng.created_by <> @user_id::uuid
	                      AND ng.created_at >= @not_before::timestamptz))
	   OR ((SELECT comments FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."comments" nc
	                    WHERE nc.author_id <> @user_id::uuid
	                      AND nc.created_at >= @not_before::timestamptz))
	   OR ((SELECT published FROM pref)
	       AND (SELECT revision_scope FROM pref) <> 'mine'
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."revisions" nr
	                    WHERE nr.approved_at >= @not_before::timestamptz
	                      AND nr.author_user_id <> @user_id::uuid))
	   OR ((SELECT decisions FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."access_requests" nar
	                    WHERE nar.requester_id = @user_id::uuid
	                      AND nar.resolution = 'granted'
	                      AND nar.resolved_at >= @not_before::timestamptz))
),
items AS (
	SELECT r.id, 'accessRequest'::text AS kind, a.id AS artifact_id, NULL::uuid AS project_id,
	       a.title, u.name AS actor_name, NULL::int AS revision, r.role, NULL::text AS outcome,
	       NULL::text AS subject, r.note, r.created_at
	FROM "exagram"."access_requests" r
	JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	JOIN "exagram"."users" u ON u.id = r.requester_id
	WHERE (SELECT access_requests FROM pref)
	  AND a.owner_id = @user_id::uuid
	  AND a.deleted_at IS NULL
	  AND r.resolved_at IS NULL
	  AND "exagram".live_member(u.id, a.workspace_id)
	  AND NOT "exagram".reaches_artifact(u.id, a.id)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND r.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT p.revision_id, 'pendingRevision'::text, p.artifact_id, NULL::uuid,
	       a.title,
	       COALESCE(CASE WHEN p.author_user_id = @user_id::uuid THEN c.name END, u.name),
	       p.seq, NULL::text, NULL::text, NULL::text, NULL::text,
	       p.created_at
	FROM "exagram"."pending_revisions"(@user_id::uuid) p
	JOIN "exagram"."artifacts" a ON a.id = p.artifact_id
	JOIN "exagram"."users" u ON u.id = p.author_user_id
	LEFT JOIN "exagram"."connections" c ON c.id = p.author_connection_id
	WHERE (SELECT pending_revisions FROM pref)
	  AND p.is_approver
	  AND NOT (p.author_user_id = @user_id::uuid AND p.author_connection_id IS NULL)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND p.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT g.id, 'grant'::text, a.id, NULL::uuid,
	       a.title,
	       CASE
	         WHEN g.created_by = a.owner_id
	           OR EXISTS (SELECT 1
	                        FROM "exagram"."grants" sg
	                       WHERE sg.artifact_id = a.id
	                         AND sg.grantee_id = g.created_by)
	         THEN u.name
	       END,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       g.created_at
	FROM "exagram"."grants" g
	JOIN visible v ON v.artifact_id = g.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	JOIN "exagram"."users" u ON u.id = g.created_by
	WHERE (SELECT grants FROM pref)
	  AND g.grantee_id = @user_id::uuid
	  AND g.created_by <> @user_id::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  -- The decision is sent under the same conditions as this row (visible, not muted) plus its own switch.
	  AND NOT ((SELECT decisions FROM pref)
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."access_requests" ar
	                        WHERE ar.artifact_id = g.artifact_id
	                          AND ar.requester_id = @user_id::uuid
	                          AND ar.resolution = 'granted'
	                          AND ar.resolved_at = g.created_at))
	  AND g.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT g.id, 'grant'::text, NULL::uuid, p.id,
	       p.name,
	       CASE
	         WHEN g.created_by = p.owner_id THEN u.name
	         WHEN (p.owner_id = @user_id::uuid
	               OR EXISTS (SELECT 1
	                            FROM "exagram"."grants" mine
	                           WHERE mine.grantee_id = @user_id::uuid
	                             AND mine.project_id IN (p.id, p.parent_project_id)
	                             AND mine.role IN ('edit', 'collaborate')))
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."grants" mg
	                        WHERE mg.project_id IN (p.id, p.parent_project_id)
	                          AND mg.grantee_id = g.created_by
	                          AND mg.grantee_id <> p.owner_id)
	         THEN u.name
	       END,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       g.created_at
	FROM "exagram"."grants" g
	JOIN "exagram"."projects" p ON p.id = g.project_id
	JOIN "exagram"."users" u ON u.id = g.created_by
	WHERE (SELECT grants FROM pref)
	  AND g.grantee_id = @user_id::uuid
	  AND g.created_by <> @user_id::uuid
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = p.id)
	  AND g.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT c.id, 'comment'::text, a.id, NULL::uuid,
	       a.title, u.name,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       c.created_at
	FROM visible v
	JOIN "exagram"."comments" c ON c.revision_id = v.revision_id
	JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
	JOIN "exagram"."users" u ON u.id = c.author_id
	WHERE (SELECT comments FROM pref)
	  AND c.author_id <> @user_id::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND c.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT r.id, 'decision'::text, a.id, NULL::uuid,
	       a.title, o.name,
	       NULL::int, g.role, 'granted'::text, 'accessRequest'::text, NULL::text,
	       r.resolved_at
	FROM "exagram"."access_requests" r
	JOIN visible v ON v.artifact_id = r.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	JOIN "exagram"."users" o ON o.id = a.owner_id
	JOIN "exagram"."grants" g ON g.artifact_id = a.id AND g.grantee_id = @user_id::uuid
	WHERE (SELECT decisions FROM pref)
	  AND r.requester_id = @user_id::uuid
	  AND r.resolution = 'granted'
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND r.resolved_at >= @not_before::timestamptz

	UNION ALL

	SELECT r.id, 'decision'::text, r.artifact_id, NULL::uuid,
	       ''::text, NULL::text,
	       NULL::int, NULL::text, 'declined'::text, 'accessRequest'::text, NULL::text,
	       r.resolved_at
	FROM "exagram"."access_requests" r
	WHERE (SELECT decisions FROM pref)
	  AND r.requester_id = @user_id::uuid
	  AND r.resolution = 'dismissed'
	  AND r.resolved_at >= @not_before::timestamptz

	UNION ALL

	SELECT rv.id, 'decision'::text, a.id, NULL::uuid,
	       a.title,
	       -- The approver is the Artifact's Owner, or the Owner of its folder, whom the author sees in the
	       -- folder list when they reach the folder.
	       CASE
	         WHEN o.id = a.owner_id THEN o.name
	         WHEN a.project_id IS NOT NULL
	           AND "exagram".user_project_role(@user_id::uuid, a.project_id) IS NOT NULL
	         THEN o.name
	       END,
	       rv.seq, NULL::text,
	       CASE WHEN rv.status = 'approved' THEN 'approved' ELSE 'discarded' END,
	       'revision'::text, NULL::text,
	       COALESCE(rv.discarded_at, rv.approved_at)
	FROM "exagram"."revisions" rv
	JOIN "exagram"."artifacts" a ON a.id = rv.artifact_id
	JOIN "exagram"."users" o ON o.id = "exagram".artifact_owner(a.id)
	WHERE (SELECT decisions FROM pref)
	  AND rv.author_user_id = @user_id::uuid
	  AND ((rv.status = 'approved' AND rv.approved_at > rv.created_at AND rv.approved_at >= @not_before::timestamptz)
	       OR (rv.status = 'discarded' AND rv.discarded_at >= @not_before::timestamptz))
	  AND a.deleted_at IS NULL
	  AND o.id <> @user_id::uuid
	  AND "exagram".reaches_artifact(@user_id::uuid, a.id)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)

	UNION ALL

	SELECT rv.id, 'published'::text, a.id, NULL::uuid,
	       a.title,
	       CASE
	         WHEN rv.author_user_id = a.owner_id THEN u.name
	         WHEN EXISTS (SELECT 1
	                        FROM "exagram"."grants" sg
	                       WHERE sg.artifact_id = a.id
	                         AND sg.grantee_id = rv.author_user_id
	                         AND sg.role IN ('edit', 'collaborate'))
	         THEN u.name
	         WHEN fp.id IS NOT NULL
	           AND (fp.owner_id = @user_id::uuid
	                OR EXISTS (SELECT 1
	                             FROM "exagram"."grants" mine
	                            WHERE mine.grantee_id = @user_id::uuid
	                              AND mine.project_id IN (fp.id, fp.parent_project_id)
	                              AND mine.role IN ('edit', 'collaborate')))
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."grants" mg
	                        WHERE mg.project_id IN (fp.id, fp.parent_project_id)
	                          AND mg.grantee_id = rv.author_user_id
	                          AND mg.role IN ('edit', 'collaborate'))
	         THEN u.name
	       END,
	       rv.seq, NULL::text, NULL::text, NULL::text, NULL::text,
	       rv.approved_at
	FROM visible v
	JOIN "exagram"."revisions" rv ON rv.artifact_id = v.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
	JOIN "exagram"."users" u ON u.id = rv.author_user_id
	LEFT JOIN "exagram"."projects" fp ON fp.id = a.project_id
	WHERE (SELECT published FROM pref)
	  AND (SELECT revision_scope FROM pref) <> 'mine'
	  AND NOT v.pinned
	  AND rv.status = 'approved'
	  AND rv.author_user_id <> @user_id::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND ((SELECT revision_scope FROM pref) = 'all'
	       OR EXISTS (SELECT 1
	                    FROM "exagram"."grants" dg
	                   WHERE dg.artifact_id = a.id
	                     AND dg.grantee_id = @user_id::uuid)
	       OR (fp.id IS NOT NULL
	           AND ("exagram".user_project_role(@user_id::uuid, fp.id) IS NOT NULL
	                OR "exagram".user_project_role(@user_id::uuid, fp.parent_project_id) IS NOT NULL)))
	  AND rv.approved_at >= @not_before::timestamptz

	UNION ALL

	SELECT c.id, 'connection'::text, NULL::uuid, NULL::uuid,
	       c.name, NULL::text,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       GREATEST(c.created_at, c.scopes_widened_at)
	FROM "exagram"."connections" c
	WHERE (SELECT connections FROM pref)
	  AND c.user_id = @user_id::uuid
	  AND c.revoked_at IS NULL
	  AND GREATEST(c.created_at, c.scopes_widened_at) >= @not_before::timestamptz
)
SELECT items.id, items.kind, items.artifact_id, items.project_id, items.title, items.actor_name, items.revision,
       items.role, items.outcome, items.subject, items.note, items.created_at,
       to_char(items.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
FROM items
CROSS JOIN LATERAL (
	SELECT COALESCE(
	        (SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = items.artifact_id),
	        (SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = items.project_id),
	        (SELECT c.workspace_id FROM "exagram"."connections" c WHERE c.id = items.id AND items.kind = 'connection')
	       ) AS workspace_id
) item
WHERE item.workspace_id = @workspace_id::uuid
  AND (sqlc.narg('after_id')::uuid IS NULL
       OR (items.created_at, items.id) > (sqlc.narg('after_at')::text::timestamptz, sqlc.narg('after_id')::uuid))
ORDER BY items.created_at ASC, items.id ASC
LIMIT @max_rows::int;

-- name: ListNotificationEmailItems :many
-- Notification Email's rows: ListNotificationsSince's body with the member's four email switches and the ADR 0040
-- kinds off (ADR 0039), read across Workspaces because a mail has no session. A row is kept only while the
-- Workspace that owns it has email on, and was made since it last went on, so an Admin's switch covers its Guests
-- too and what it made while off is never mailed; a row whose Workspace cannot be named is left out. not_after, when set, leaves out rows stamped after
-- it: the sweep reads only rows old enough that any transaction which stamped an earlier time has committed,
-- so its cursor never steps past one.
WITH pref AS (
	SELECT @access_requests::boolean AS access_requests,
	       @pending_revisions::boolean AS pending_revisions,
	       @grants::boolean AS grants,
	       @comments::boolean AS comments,
	       @decisions::boolean AS decisions,
	       @published::boolean AS published,
	       @connections::boolean AS connections,
	       @revision_scope::text AS revision_scope
),
muted AS MATERIALIZED (
	SELECT p.id
	FROM "exagram"."notification_muted_projects" m
	JOIN "exagram"."projects" p ON m.project_id IN (p.id, p.parent_project_id)
	WHERE m.user_id = @user_id::uuid
),
visible AS MATERIALIZED (
	SELECT v.artifact_id, v.revision_id, v.pinned
	FROM "exagram"."visible_artifacts"('user', @user_id::uuid) v
	WHERE ((SELECT grants FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."grants" ng
	                    WHERE ng.grantee_id = @user_id::uuid
	                      AND ng.artifact_id IS NOT NULL
	                      AND ng.created_by <> @user_id::uuid
	                      AND ng.created_at >= @not_before::timestamptz))
	   OR ((SELECT comments FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."comments" nc
	                    WHERE nc.author_id <> @user_id::uuid
	                      AND nc.created_at >= @not_before::timestamptz))
	   OR ((SELECT published FROM pref)
	       AND (SELECT revision_scope FROM pref) <> 'mine'
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."revisions" nr
	                    WHERE nr.approved_at >= @not_before::timestamptz
	                      AND nr.author_user_id <> @user_id::uuid))
	   OR ((SELECT decisions FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."access_requests" nar
	                    WHERE nar.requester_id = @user_id::uuid
	                      AND nar.resolution = 'granted'
	                      AND nar.resolved_at >= @not_before::timestamptz))
),
items AS (
	SELECT r.id, 'accessRequest'::text AS kind, a.id AS artifact_id, NULL::uuid AS project_id,
	       a.title, u.name AS actor_name, NULL::int AS revision, r.role, NULL::text AS outcome,
	       NULL::text AS subject, r.note, r.created_at
	FROM "exagram"."access_requests" r
	JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	JOIN "exagram"."users" u ON u.id = r.requester_id
	WHERE (SELECT access_requests FROM pref)
	  AND a.owner_id = @user_id::uuid
	  AND a.deleted_at IS NULL
	  AND r.resolved_at IS NULL
	  AND "exagram".live_member(u.id, a.workspace_id)
	  AND NOT "exagram".reaches_artifact(u.id, a.id)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND r.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT p.revision_id, 'pendingRevision'::text, p.artifact_id, NULL::uuid,
	       a.title,
	       COALESCE(CASE WHEN p.author_user_id = @user_id::uuid THEN c.name END, u.name),
	       p.seq, NULL::text, NULL::text, NULL::text, NULL::text,
	       p.created_at
	FROM "exagram"."pending_revisions"(@user_id::uuid) p
	JOIN "exagram"."artifacts" a ON a.id = p.artifact_id
	JOIN "exagram"."users" u ON u.id = p.author_user_id
	LEFT JOIN "exagram"."connections" c ON c.id = p.author_connection_id
	WHERE (SELECT pending_revisions FROM pref)
	  AND p.is_approver
	  AND NOT (p.author_user_id = @user_id::uuid AND p.author_connection_id IS NULL)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND p.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT g.id, 'grant'::text, a.id, NULL::uuid,
	       a.title,
	       CASE
	         WHEN g.created_by = a.owner_id
	           OR EXISTS (SELECT 1
	                        FROM "exagram"."grants" sg
	                       WHERE sg.artifact_id = a.id
	                         AND sg.grantee_id = g.created_by)
	         THEN u.name
	       END,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       g.created_at
	FROM "exagram"."grants" g
	JOIN visible v ON v.artifact_id = g.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	JOIN "exagram"."users" u ON u.id = g.created_by
	WHERE (SELECT grants FROM pref)
	  AND g.grantee_id = @user_id::uuid
	  AND g.created_by <> @user_id::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  -- The decision is sent under the same conditions as this row (visible, not muted) plus its own switch.
	  AND NOT ((SELECT decisions FROM pref)
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."access_requests" ar
	                        WHERE ar.artifact_id = g.artifact_id
	                          AND ar.requester_id = @user_id::uuid
	                          AND ar.resolution = 'granted'
	                          AND ar.resolved_at = g.created_at))
	  AND g.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT g.id, 'grant'::text, NULL::uuid, p.id,
	       p.name,
	       CASE
	         WHEN g.created_by = p.owner_id THEN u.name
	         WHEN (p.owner_id = @user_id::uuid
	               OR EXISTS (SELECT 1
	                            FROM "exagram"."grants" mine
	                           WHERE mine.grantee_id = @user_id::uuid
	                             AND mine.project_id IN (p.id, p.parent_project_id)
	                             AND mine.role IN ('edit', 'collaborate')))
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."grants" mg
	                        WHERE mg.project_id IN (p.id, p.parent_project_id)
	                          AND mg.grantee_id = g.created_by
	                          AND mg.grantee_id <> p.owner_id)
	         THEN u.name
	       END,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       g.created_at
	FROM "exagram"."grants" g
	JOIN "exagram"."projects" p ON p.id = g.project_id
	JOIN "exagram"."users" u ON u.id = g.created_by
	WHERE (SELECT grants FROM pref)
	  AND g.grantee_id = @user_id::uuid
	  AND g.created_by <> @user_id::uuid
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = p.id)
	  AND g.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT c.id, 'comment'::text, a.id, NULL::uuid,
	       a.title, u.name,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       c.created_at
	FROM visible v
	JOIN "exagram"."comments" c ON c.revision_id = v.revision_id
	JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
	JOIN "exagram"."users" u ON u.id = c.author_id
	WHERE (SELECT comments FROM pref)
	  AND c.author_id <> @user_id::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND c.created_at >= @not_before::timestamptz

	UNION ALL

	SELECT r.id, 'decision'::text, a.id, NULL::uuid,
	       a.title, o.name,
	       NULL::int, g.role, 'granted'::text, 'accessRequest'::text, NULL::text,
	       r.resolved_at
	FROM "exagram"."access_requests" r
	JOIN visible v ON v.artifact_id = r.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	JOIN "exagram"."users" o ON o.id = a.owner_id
	JOIN "exagram"."grants" g ON g.artifact_id = a.id AND g.grantee_id = @user_id::uuid
	WHERE (SELECT decisions FROM pref)
	  AND r.requester_id = @user_id::uuid
	  AND r.resolution = 'granted'
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND r.resolved_at >= @not_before::timestamptz

	UNION ALL

	SELECT r.id, 'decision'::text, r.artifact_id, NULL::uuid,
	       ''::text, NULL::text,
	       NULL::int, NULL::text, 'declined'::text, 'accessRequest'::text, NULL::text,
	       r.resolved_at
	FROM "exagram"."access_requests" r
	WHERE (SELECT decisions FROM pref)
	  AND r.requester_id = @user_id::uuid
	  AND r.resolution = 'dismissed'
	  AND r.resolved_at >= @not_before::timestamptz

	UNION ALL

	SELECT rv.id, 'decision'::text, a.id, NULL::uuid,
	       a.title,
	       -- The approver is the Artifact's Owner, or the Owner of its folder, whom the author sees in the
	       -- folder list when they reach the folder.
	       CASE
	         WHEN o.id = a.owner_id THEN o.name
	         WHEN a.project_id IS NOT NULL
	           AND "exagram".user_project_role(@user_id::uuid, a.project_id) IS NOT NULL
	         THEN o.name
	       END,
	       rv.seq, NULL::text,
	       CASE WHEN rv.status = 'approved' THEN 'approved' ELSE 'discarded' END,
	       'revision'::text, NULL::text,
	       COALESCE(rv.discarded_at, rv.approved_at)
	FROM "exagram"."revisions" rv
	JOIN "exagram"."artifacts" a ON a.id = rv.artifact_id
	JOIN "exagram"."users" o ON o.id = "exagram".artifact_owner(a.id)
	WHERE (SELECT decisions FROM pref)
	  AND rv.author_user_id = @user_id::uuid
	  AND ((rv.status = 'approved' AND rv.approved_at > rv.created_at AND rv.approved_at >= @not_before::timestamptz)
	       OR (rv.status = 'discarded' AND rv.discarded_at >= @not_before::timestamptz))
	  AND a.deleted_at IS NULL
	  AND o.id <> @user_id::uuid
	  AND "exagram".reaches_artifact(@user_id::uuid, a.id)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)

	UNION ALL

	SELECT rv.id, 'published'::text, a.id, NULL::uuid,
	       a.title,
	       CASE
	         WHEN rv.author_user_id = a.owner_id THEN u.name
	         WHEN EXISTS (SELECT 1
	                        FROM "exagram"."grants" sg
	                       WHERE sg.artifact_id = a.id
	                         AND sg.grantee_id = rv.author_user_id
	                         AND sg.role IN ('edit', 'collaborate'))
	         THEN u.name
	         WHEN fp.id IS NOT NULL
	           AND (fp.owner_id = @user_id::uuid
	                OR EXISTS (SELECT 1
	                             FROM "exagram"."grants" mine
	                            WHERE mine.grantee_id = @user_id::uuid
	                              AND mine.project_id IN (fp.id, fp.parent_project_id)
	                              AND mine.role IN ('edit', 'collaborate')))
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."grants" mg
	                        WHERE mg.project_id IN (fp.id, fp.parent_project_id)
	                          AND mg.grantee_id = rv.author_user_id
	                          AND mg.role IN ('edit', 'collaborate'))
	         THEN u.name
	       END,
	       rv.seq, NULL::text, NULL::text, NULL::text, NULL::text,
	       rv.approved_at
	FROM visible v
	JOIN "exagram"."revisions" rv ON rv.artifact_id = v.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
	JOIN "exagram"."users" u ON u.id = rv.author_user_id
	LEFT JOIN "exagram"."projects" fp ON fp.id = a.project_id
	WHERE (SELECT published FROM pref)
	  AND (SELECT revision_scope FROM pref) <> 'mine'
	  AND NOT v.pinned
	  AND rv.status = 'approved'
	  AND rv.author_user_id <> @user_id::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND ((SELECT revision_scope FROM pref) = 'all'
	       OR EXISTS (SELECT 1
	                    FROM "exagram"."grants" dg
	                   WHERE dg.artifact_id = a.id
	                     AND dg.grantee_id = @user_id::uuid)
	       OR (fp.id IS NOT NULL
	           AND ("exagram".user_project_role(@user_id::uuid, fp.id) IS NOT NULL
	                OR "exagram".user_project_role(@user_id::uuid, fp.parent_project_id) IS NOT NULL)))
	  AND rv.approved_at >= @not_before::timestamptz

	UNION ALL

	SELECT c.id, 'connection'::text, NULL::uuid, NULL::uuid,
	       c.name, NULL::text,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       GREATEST(c.created_at, c.scopes_widened_at)
	FROM "exagram"."connections" c
	WHERE (SELECT connections FROM pref)
	  AND c.user_id = @user_id::uuid
	  AND c.revoked_at IS NULL
	  AND GREATEST(c.created_at, c.scopes_widened_at) >= @not_before::timestamptz
)
SELECT items.id, items.kind, items.artifact_id, items.project_id, items.title, items.actor_name, items.revision,
       items.role, items.outcome, items.subject, items.note, items.created_at,
       to_char(items.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
FROM items
CROSS JOIN LATERAL (
	SELECT COALESCE(
	        (SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = items.artifact_id),
	        (SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = items.project_id),
	        (SELECT c.workspace_id FROM "exagram"."connections" c WHERE c.id = items.id AND items.kind = 'connection')
	       ) AS workspace_id
) item
WHERE COALESCE((
        SELECT w.notification_email_enabled
           AND (w.notification_email_resumed_at IS NULL OR items.created_at >= w.notification_email_resumed_at)
        FROM "exagram"."workspaces" w WHERE w.id = item.workspace_id
      ), false)
  AND (sqlc.narg('after_id')::uuid IS NULL
       OR (items.created_at, items.id) > (sqlc.narg('after_at')::text::timestamptz, sqlc.narg('after_id')::uuid))
  AND (sqlc.narg('not_after')::timestamptz IS NULL OR items.created_at <= sqlc.narg('not_after')::timestamptz)
ORDER BY items.created_at ASC, items.id ASC
LIMIT @max_rows::int;

-- name: GetDatabaseNow :one
-- The database's clock, so a device's first cursor and every created_at it is compared with come from
-- one clock.
SELECT now()::timestamptz AS now;
