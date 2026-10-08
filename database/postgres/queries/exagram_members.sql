-- name: ListWorkspaceMembers :many
-- joined_at is set when an Invited Member's row is claimed; any other row joined when it was made.
SELECT u.id, u.name, u.email::text AS email, (m.role = 'admin')::boolean AS is_admin,
       COALESCE(m.joined_at, m.created_at)::timestamptz AS joined_at,
       m.last_seen_at,
       (w.owner_id IS NOT NULL AND w.owner_id = u.id)::boolean AS is_workspace_owner,
       (SELECT count(*) FROM "exagram"."projects" p
        WHERE p.owner_id = u.id AND p.workspace_id = m.workspace_id)::int AS project_count,
       (SELECT count(*) FROM "exagram"."connections" c
        WHERE c.user_id = u.id AND c.workspace_id = m.workspace_id AND c.revoked_at IS NULL)::int AS connection_count
FROM "exagram"."memberships" m
JOIN "exagram"."users" u ON u.id = m.user_id
JOIN "exagram"."workspaces" w ON w.id = m.workspace_id
WHERE m.workspace_id = @workspace_id::uuid AND m.removed_at IS NULL AND m.invited_at IS NULL
ORDER BY u.name, u.email;

-- name: LockWorkspaceForMembers :one
-- NO KEY UPDATE, so inserts that reference the Workspace (Artifacts, Projects, users) are not held up.
SELECT id, owner_id FROM "exagram"."workspaces" WHERE id = @id::uuid FOR NO KEY UPDATE;

-- name: LockWorkspaceMember :one
SELECT u.id, u.name, u.email::text AS email, (m.role = 'admin')::boolean AS is_admin,
       COALESCE(m.joined_at, m.created_at)::timestamptz AS joined_at
FROM "exagram"."users" u
JOIN "exagram"."memberships" m ON m.user_id = u.id AND m.workspace_id = @workspace_id::uuid
WHERE u.id = @id::uuid AND m.removed_at IS NULL AND m.invited_at IS NULL
FOR NO KEY UPDATE OF m;

-- name: CountWorkspaceAdmins :one
SELECT count(*)::int AS total FROM "exagram"."memberships"
WHERE workspace_id = @workspace_id::uuid AND role = 'admin' AND removed_at IS NULL AND invited_at IS NULL;

-- name: SetMemberAdmin :one
WITH membership AS (
	UPDATE "exagram"."memberships" SET role = CASE WHEN @is_admin::boolean THEN 'admin' ELSE 'member' END
	WHERE user_id = @id::uuid AND workspace_id = @workspace_id::uuid
	RETURNING user_id
), mirror AS (
	UPDATE "exagram"."users" u SET is_admin = @is_admin::boolean
	FROM membership WHERE u.id = membership.user_id AND u.workspace_id = @workspace_id::uuid
)
SELECT user_id AS id FROM membership;

-- name: MemberOwnsAnything :one
SELECT (
	EXISTS (SELECT 1 FROM "exagram"."projects" p
	        WHERE p.owner_id = @user_id::uuid AND p.workspace_id = @workspace_id::uuid)
	OR EXISTS (SELECT 1 FROM "exagram"."artifacts" a
	           WHERE a.owner_id = @user_id::uuid AND a.workspace_id = @workspace_id::uuid)
)::boolean AS owns;

-- name: RenameCollidingProjects :exec
UPDATE "exagram"."projects" p
SET name = CASE
  WHEN EXISTS (
    SELECT 1 FROM "exagram"."projects" r
    WHERE r.owner_id = @to_user_id::uuid
      AND r.workspace_id = p.workspace_id
      AND r.name = p.name || ' (' || @suffix::text || ')'
      AND r.parent_project_id IS NOT DISTINCT FROM p.parent_project_id
  ) THEN p.name || ' (' || @suffix::text || ' ' || left(p.id::text, 8) || ')'
  ELSE p.name || ' (' || @suffix::text || ')'
END
WHERE p.owner_id = @from_user_id::uuid
  AND p.workspace_id = @workspace_id::uuid
  AND EXISTS (
    SELECT 1 FROM "exagram"."projects" q
    WHERE q.owner_id = @to_user_id::uuid
      AND q.workspace_id = p.workspace_id
      AND q.name = p.name
      AND q.parent_project_id IS NOT DISTINCT FROM p.parent_project_id
  );

-- name: TransferProjects :many
UPDATE "exagram"."projects" SET owner_id = @to_user_id::uuid
WHERE owner_id = @from_user_id::uuid AND workspace_id = @workspace_id::uuid
RETURNING id;

-- name: TransferArtifacts :many
UPDATE "exagram"."artifacts" SET owner_id = @to_user_id::uuid
WHERE owner_id = @from_user_id::uuid AND workspace_id = @workspace_id::uuid
RETURNING id;

-- name: DeleteGrantsOnOwnedItems :many
DELETE FROM "exagram"."grants" g
WHERE g.grantee_id = @user_id::uuid
  AND (
    EXISTS (SELECT 1 FROM "exagram"."projects" p WHERE p.id = g.project_id AND p.owner_id = @user_id::uuid)
    OR (g.artifact_id IS NOT NULL AND "exagram".artifact_owner(g.artifact_id) = @user_id::uuid)
  )
RETURNING g.id;

-- name: DeleteGrantsHeldInWorkspace :many
DELETE FROM "exagram"."grants" g
WHERE g.grantee_id = @user_id::uuid
  AND (
    EXISTS (SELECT 1 FROM "exagram"."artifacts" a
            WHERE a.id = g.artifact_id AND a.workspace_id = @workspace_id::uuid)
    OR EXISTS (SELECT 1 FROM "exagram"."projects" p
               WHERE p.id = g.project_id AND p.workspace_id = @workspace_id::uuid)
  )
RETURNING g.id;

-- name: RevokeLinksCreatedInWorkspace :many
UPDATE "exagram"."links" l SET revoked_at = now()
FROM "exagram"."artifacts" a
WHERE a.id = l.artifact_id AND a.workspace_id = @workspace_id::uuid
  AND l.created_by = @user_id::uuid AND l.revoked_at IS NULL
RETURNING l.id;

-- name: RevokeConnectionsInWorkspace :many
UPDATE "exagram"."connections" SET revoked_at = now()
WHERE user_id = @user_id::uuid AND workspace_id = @workspace_id::uuid AND revoked_at IS NULL
RETURNING id, oidc_grant_id;

-- name: DeleteSessionsInWorkspace :many
DELETE FROM "exagram"."sessions" WHERE user_id = @user_id::uuid AND workspace_id = @workspace_id::uuid
RETURNING id;

-- name: DeletePasswordResetsInWorkspace :many
DELETE FROM "exagram"."password_resets" r
WHERE r.user_id = @user_id::uuid AND r.created_by IN (
	SELECT m.user_id FROM "exagram"."memberships" m
	WHERE m.workspace_id = @workspace_id::uuid AND m.role = 'admin' AND "exagram".live_member(m.user_id, m.workspace_id))
RETURNING r.id;

-- name: DeleteOpenAccessRequestsInWorkspace :many
DELETE FROM "exagram"."access_requests" r
USING "exagram"."artifacts" a
WHERE a.id = r.artifact_id AND a.workspace_id = @workspace_id::uuid
  AND r.requester_id = @user_id::uuid AND r.resolved_at IS NULL
RETURNING r.id;

-- name: DeleteInvitesSentInWorkspace :many
DELETE FROM "exagram"."workspace_invites"
WHERE invited_by = @user_id::uuid AND workspace_id = @workspace_id::uuid
RETURNING id;

-- name: MarkMemberRemoved :one
WITH membership AS (
	UPDATE "exagram"."memberships" SET removed_at = now()
	WHERE user_id = @id::uuid AND workspace_id = @workspace_id::uuid AND removed_at IS NULL
	RETURNING user_id
), mirror AS (
	UPDATE "exagram"."users" u SET removed_at = now()
	FROM membership WHERE u.id = membership.user_id AND u.workspace_id = @workspace_id::uuid AND u.removed_at IS NULL
)
SELECT user_id AS id FROM membership;

-- name: LockLegacyHomeUserRow :many
SELECT id FROM "exagram"."users" WHERE id = @id::uuid AND workspace_id = @workspace_id::uuid FOR NO KEY UPDATE;
