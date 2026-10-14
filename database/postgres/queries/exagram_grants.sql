-- name: ListGrantsByArtifact :many
SELECT g.id, g.artifact_id, g.project_id, g.grantee_id, g.group_id, g.role, g.pinned_revision_id, g.created_by,
       g.created_at,
       u.email::text AS grantee_email, u.name AS grantee_name,
       (g.group_id IS NULL AND (g.dormant OR "exagram".grantee_pending(u.id, t.workspace_id)))::boolean AS grantee_pending,
       grp.name AS group_name, "exagram".group_member_count(g.group_id)::int AS group_member_count
FROM "exagram"."grants" g
LEFT JOIN "exagram"."users" u ON u.id = g.grantee_id
LEFT JOIN "exagram"."groups" grp ON grp.id = g.group_id
JOIN "exagram"."artifacts" t ON t.id = g.artifact_id
WHERE g.artifact_id = @artifact_id::uuid
ORDER BY g.created_at ASC;

-- name: ListGrantsByProject :many
SELECT g.id, g.artifact_id, g.project_id, g.grantee_id, g.group_id, g.role, g.pinned_revision_id, g.created_by,
       g.created_at,
       u.email::text AS grantee_email, u.name AS grantee_name,
       (g.group_id IS NULL AND (g.dormant OR "exagram".grantee_pending(u.id, t.workspace_id)))::boolean AS grantee_pending,
       grp.name AS group_name, "exagram".group_member_count(g.group_id)::int AS group_member_count
FROM "exagram"."grants" g
LEFT JOIN "exagram"."users" u ON u.id = g.grantee_id
LEFT JOIN "exagram"."groups" grp ON grp.id = g.group_id
JOIN "exagram"."projects" t ON t.id = g.project_id
WHERE g.project_id = @project_id::uuid
ORDER BY g.created_at ASC;

-- name: GetGrantById :one
SELECT g.id, g.artifact_id, g.project_id, g.grantee_id, g.group_id, g.role, g.pinned_revision_id, g.created_by,
       g.created_at,
       u.email::text AS grantee_email, u.name AS grantee_name,
       (g.group_id IS NULL
         AND (g.dormant OR "exagram".grantee_pending(u.id, COALESCE(a.workspace_id, p.workspace_id))))::boolean
         AS grantee_pending,
       grp.name AS group_name, "exagram".group_member_count(g.group_id)::int AS group_member_count
FROM "exagram"."grants" g
LEFT JOIN "exagram"."users" u ON u.id = g.grantee_id
LEFT JOIN "exagram"."groups" grp ON grp.id = g.group_id
LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
WHERE g.id = @id::uuid;

-- name: InsertGrant :one
-- Where the install can prove an email (`email_proof`), a Grant to someone who has not proven theirs and is not a live
-- member of the target's Workspace is dormant: it reaches them once they prove the email or that Workspace admits them.
WITH target AS (
	SELECT COALESCE(
		(SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = sqlc.narg('artifact_id')::uuid),
		(SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = sqlc.narg('project_id')::uuid)
	) AS workspace_id
)
INSERT INTO "exagram"."grants" (artifact_id, project_id, grantee_id, group_id, role, pinned_revision_id, created_by, dormant)
SELECT sqlc.narg('artifact_id')::uuid, sqlc.narg('project_id')::uuid, sqlc.narg('grantee_id')::uuid,
       sqlc.narg('group_id')::uuid, @role::text, sqlc.narg('pinned_revision_id')::uuid, @created_by::uuid,
       sqlc.narg('grantee_id')::uuid IS NOT NULL AND @email_proof::boolean
         AND NOT "exagram".live_member(sqlc.narg('grantee_id')::uuid, t.workspace_id)
         AND NOT "exagram".email_proven(sqlc.narg('grantee_id')::uuid)
FROM target t
WHERE "exagram".writer_in_workspace(@created_by::uuid, t.workspace_id)
RETURNING id;

-- name: FindGroupInWorkspace :one
SELECT g.id FROM "exagram"."groups" g WHERE g.id = @group_id::uuid AND g.workspace_id = @workspace_id::uuid;

-- name: UpdateGrantRole :one
UPDATE "exagram"."grants" SET role = @role::text WHERE id = @id::uuid RETURNING id;

-- name: UpdateGrantPin :one
UPDATE "exagram"."grants" SET pinned_revision_id = sqlc.narg('pinned_revision_id')::uuid
WHERE id = @id::uuid RETURNING id;

-- name: DeleteGrant :one
DELETE FROM "exagram"."grants" WHERE id = @id::uuid RETURNING id;

-- name: GetLiveTargetWorkspace :one
SELECT t.workspace_id, w.kind FROM (
	SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = sqlc.narg('artifact_id')::uuid
	UNION ALL
	SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = sqlc.narg('project_id')::uuid
) t
JOIN "exagram"."workspaces" w ON w.id = t.workspace_id
WHERE "exagram".live_member(@user_id::uuid, t.workspace_id)
LIMIT 1;

-- name: FindGranteeInWorkspace :one
SELECT u.id FROM "exagram"."users" u
WHERE u.email = @email::citext AND EXISTS (
	SELECT 1 FROM "exagram"."grants" g
	LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
	WHERE g.grantee_id = u.id AND COALESCE(a.workspace_id, p.workspace_id) = @workspace_id::uuid
);

-- name: FindMemberByEmail :one
SELECT u.id FROM "exagram"."users" u
JOIN "exagram"."memberships" m ON m.user_id = u.id AND m.workspace_id = @workspace_id::uuid AND m.removed_at IS NULL
WHERE u.email = @email::citext;

-- name: FindGranteeByEmail :one
SELECT u.id FROM "exagram"."users" u
WHERE u.email = @email::citext AND "exagram".has_live_membership(u.id);

-- name: LockMembershipsByEmail :many
-- Whoever holds the email, before InsertInvitedMember may take their row: the orphan sweep skips them, or has already
-- deleted them and the insert creates a fresh row.
SELECT m.workspace_id FROM "exagram"."memberships" m
JOIN "exagram"."users" u ON u.id = m.user_id
WHERE u.email = @email::citext
ORDER BY m.workspace_id
FOR NO KEY UPDATE OF m;

-- name: InsertInvitedMember :one
WITH created AS (
	INSERT INTO "exagram"."users" (email, name, password_hash, unclaimed)
	VALUES (@email::citext, @name::text, @claim_password_hash::text, true)
	ON CONFLICT (email) DO NOTHING
	RETURNING id
), invitee AS (
	SELECT id FROM created
	UNION ALL
	SELECT u.id FROM "exagram"."users" u
	WHERE u.email = @email::citext AND NOT EXISTS (SELECT 1 FROM created)
	  AND NOT "exagram".has_live_membership(u.id)
), membership AS (
	INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, invited_at)
	SELECT i.id, w.id, w.kind, 'member', now()
	FROM invitee i JOIN "exagram"."workspaces" w ON w.id = @workspace_id::uuid AND w.kind = 'team'
	ON CONFLICT (user_id, workspace_id) DO NOTHING
)
SELECT id FROM invitee;

-- name: ReleaseInvitedMembership :exec
WITH released AS (
	DELETE FROM "exagram"."memberships" m
	WHERE m.user_id = @id::uuid AND m.workspace_id = @workspace_id::uuid
	  AND m.invited_at IS NOT NULL AND m.removed_at IS NULL
	  AND NOT EXISTS (
		SELECT 1 FROM "exagram"."grants" g
		LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
		WHERE g.grantee_id = m.user_id AND COALESCE(a.workspace_id, p.workspace_id) = m.workspace_id
	  )
	RETURNING m.user_id
), leaving AS (
	SELECT user_id FROM released
	UNION
	SELECT u.id FROM "exagram"."users" u
	WHERE u.id = @id::uuid AND "exagram".is_personal(@workspace_id::uuid)
	  AND NOT EXISTS (SELECT 1 FROM "exagram"."user_identities" i WHERE i.user_id = u.id)
)
DELETE FROM "exagram"."users" u
USING leaving
WHERE u.id = leaving.user_id AND u.unclaimed
  AND NOT EXISTS (
	SELECT 1 FROM "exagram"."memberships" m WHERE m.user_id = u.id AND m.workspace_id <> @workspace_id::uuid
  )
  AND NOT EXISTS (SELECT 1 FROM "exagram"."grants" g WHERE g.grantee_id = u.id);

-- name: LockBareAccount :exec
SELECT pg_advisory_xact_lock(hashtext('bare:' || lower(u.email::text))) FROM "exagram"."users" u WHERE u.id = @id::uuid;

-- name: LockBareEmail :exec
SELECT pg_advisory_xact_lock(hashtext('bare:' || lower(@email::text)));

-- name: SetArtifactDefaultPin :one
UPDATE "exagram"."artifacts" SET default_pin = @default_pin::text
WHERE id = @artifact_id::uuid AND deleted_at IS NULL RETURNING id, default_pin;

-- name: GetArtifactPinState :one
SELECT a.id, a.default_pin, a.current_revision_id, a.owner_id, a.kind, a.title
FROM "exagram"."artifacts" a WHERE a.id = @artifact_id::uuid AND a.deleted_at IS NULL;

-- name: GetUserProjectRole :one
-- The user's ranked role on a Project, 'owner' for its Owner, NULL for none: user_project_role is the one definition.
SELECT "exagram".user_project_role(@user_id::uuid, @project_id::uuid) AS role;

-- name: ListInviteSuggestions :many
-- Live members worth offering in the Share dialog: not the caller, not the target's Owner and
-- nobody who already reaches the target — reaches_artifact for an Artifact, a Grant on the Project
-- or its parent for a Project, theirs or a Group's that reaches them. Exactly one of artifact_id and
-- project_id is set. `query` arrives with LIKE wildcards already escaped.
SELECT u.id, u.name, u.email::text AS email, false::boolean AS pending
FROM "exagram"."users" u
WHERE "exagram".live_member(u.id, @workspace_id::uuid)
  AND u.id <> @caller_id::uuid
  AND u.id IS DISTINCT FROM (
    CASE
      WHEN sqlc.narg('artifact_id')::uuid IS NOT NULL THEN "exagram".artifact_owner(sqlc.narg('artifact_id')::uuid)
      ELSE (SELECT p.owner_id FROM "exagram"."projects" p WHERE p.id = sqlc.narg('project_id')::uuid)
    END
  )
  AND (
    sqlc.narg('artifact_id')::uuid IS NULL
    OR NOT "exagram".reaches_artifact(u.id, sqlc.narg('artifact_id')::uuid)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "exagram"."grants" g
    JOIN "exagram"."projects" p ON p.id = sqlc.narg('project_id')::uuid
    WHERE g.project_id IN (p.id, p.parent_project_id)
      AND (g.grantee_id = u.id
        OR (g.group_id IS NOT NULL AND "exagram".group_grant_reaches(g.group_id, u.id, NULL, g.project_id)))
  )
  AND (
    sqlc.narg('query')::text IS NULL
    OR u.name ILIKE '%' || sqlc.narg('query')::text || '%'
    OR u.email::text ILIKE '%' || sqlc.narg('query')::text || '%'
  )
ORDER BY u.name, u.email
LIMIT @max_rows::int;

-- name: ListGroupSuggestions :many
SELECT grp.id, grp.name, "exagram".group_member_count(grp.id)::int AS member_count
FROM "exagram"."groups" grp
WHERE grp.workspace_id = @workspace_id::uuid
  AND NOT EXISTS (
    SELECT 1 FROM "exagram"."grants" g
    WHERE g.group_id = grp.id
      AND (g.artifact_id = sqlc.narg('artifact_id')::uuid OR g.project_id = sqlc.narg('project_id')::uuid)
  )
  AND (sqlc.narg('query')::text IS NULL OR grp.name ILIKE '%' || sqlc.narg('query')::text || '%')
ORDER BY lower(grp.name), grp.id
LIMIT @max_rows::int;

-- name: GetUserArtifactPin :one
-- The Revision a person's own row resolves to and whether a pin or link fixed it there. An inviter
-- who is pinned can only pass on what they themselves read.
SELECT v.revision_id, v.pinned
FROM "exagram".visible_artifacts('user', @user_id::uuid) v
WHERE v.artifact_id = @artifact_id::uuid;

-- name: HasPinnedGrantUnderProject :one
-- Whether the user holds a pinned Grant on any live Artifact a Grant on this Project would reach (the
-- Project and its one level of children). Such a person may not hand out the whole Project unpinned.
SELECT EXISTS (
  SELECT 1
  FROM "exagram"."reaching_grants" g
  JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
  WHERE g.grantee_id = @user_id::uuid
    AND g.pinned_revision_id IS NOT NULL
    AND a.deleted_at IS NULL
    AND (
      a.project_id = @project_id::uuid
      OR a.project_id IN (SELECT cp.id FROM "exagram"."projects" cp WHERE cp.parent_project_id = @project_id::uuid)
    )
) AS pinned;

-- name: CountInvitedMembersBySenderSince :one
-- Shares by email to someone outside the sender's Workspace, plus the Invites they created. Each answer says
-- whether an email is held, so how fast anyone can ask is capped. Both are
-- counted from the Ledger, which keeps them after a revoke, an accept or a deleted Grant.
SELECT count(*)::int AS total
FROM "exagram"."ledger_calls" c
WHERE c.principal_kind = 'user'
  AND c.principal_id = @sender_id::uuid
  AND c.action IN ('workspace.invite.create', 'grant.share_by_email')
  AND c.started_at >= @since::timestamptz;

-- name: LockInviteKey :exec
-- Serialises the count-then-insert of the invite limits for one sender or recipient within a transaction,
-- so parallel requests cannot all count below the limit.
SELECT pg_advisory_xact_lock(hashtext(@lock_key::text));

-- name: LockOrphanInvitedMembers :many
-- First half of the orphan sweep: invited Members nobody shares anything with any more (their Grants went with a
-- deleted file or project) and nobody has signed in as. It locks each row it returns, without waiting: the user row
-- (a Grant insert in flight holds it shared and makes the sweep skip the row, and a later one waits for the sweep),
-- every membership row, and the email of a bare account. The second half runs in the same transaction and reads
-- Grants and sign-ins again.
WITH orphans AS (
	SELECT u.id FROM "exagram"."users" u
	WHERE u.unclaimed
	  AND u.created_at < @before::timestamptz
	  AND NOT EXISTS (SELECT 1 FROM "exagram"."grants" g WHERE g.grantee_id = u.id)
	  AND NOT EXISTS (SELECT 1 FROM "exagram"."user_identities" i WHERE i.user_id = u.id)
), locked AS (
	SELECT m.user_id FROM "exagram"."memberships" m
	WHERE m.user_id IN (SELECT id FROM orphans)
	ORDER BY m.user_id, m.workspace_id
	FOR NO KEY UPDATE SKIP LOCKED
), locked_counts AS (
	SELECT user_id, count(*) AS n FROM locked GROUP BY user_id
), held_counts AS (
	SELECT m.user_id, count(*) AS n FROM "exagram"."memberships" m
	WHERE m.user_id IN (SELECT id FROM orphans)
	GROUP BY m.user_id
), bare_candidates AS MATERIALIZED (
	SELECT u.id, u.email FROM "exagram"."users" u
	WHERE u.id IN (SELECT id FROM orphans) AND "exagram".bare_account(u.id)
), bare AS (
	SELECT c.id FROM bare_candidates c
	WHERE pg_try_advisory_xact_lock(hashtext('bare:' || lower(c.email::text)))
)
SELECT u.id, COALESCE(lc.n, 0)::int AS memberships
FROM "exagram"."users" u
LEFT JOIN locked_counts lc ON lc.user_id = u.id
LEFT JOIN held_counts hc ON hc.user_id = u.id
WHERE u.id IN (SELECT id FROM orphans)
  AND (
    EXISTS (SELECT 1 FROM bare b WHERE b.id = u.id)
    OR (lc.n IS NOT NULL AND lc.n = hc.n)
  )
FOR UPDATE OF u SKIP LOCKED;

-- name: DeleteLockedOrphanInvitedMembers :many
-- Second half: it runs after the locks, so its snapshot sees a Grant, a sign-in or a membership that committed after
-- the first half chose its rows, and a row that gained one stays. `memberships` is how many each row held when locked.
DELETE FROM "exagram"."users" u
USING unnest(@ids::uuid[], @memberships::int[]) AS l(id, memberships)
WHERE u.id = l.id
  AND u.unclaimed
  AND u.created_at < @before::timestamptz
  AND NOT EXISTS (SELECT 1 FROM "exagram"."grants" g WHERE g.grantee_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM "exagram"."user_identities" i WHERE i.user_id = u.id)
  AND (SELECT count(*) FROM "exagram"."memberships" m WHERE m.user_id = u.id) = l.memberships
RETURNING u.id;
