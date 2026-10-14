-- Self-service account deletion. Every statement runs inside the one transaction the usecase opens.

-- name: LockAccountForDeletion :one
-- The account row, locked until the transaction ends, so two deletions of one account queue. The live Team is
-- the one Team membership neither Removed nor Invited.
SELECT u.id, u.email::text AS email, u.name, apple.subject AS apple_subject,
       personal.workspace_id AS personal_workspace_id, team.workspace_id AS team_workspace_id
FROM "exagram"."users" u
LEFT JOIN "exagram"."user_identities" apple ON apple.user_id = u.id AND apple.provider = 'apple'
LEFT JOIN "exagram"."memberships" personal ON personal.user_id = u.id AND personal.kind = 'personal'
LEFT JOIN "exagram"."memberships" team
       ON team.user_id = u.id AND team.kind = 'team' AND team.removed_at IS NULL AND team.invited_at IS NULL
WHERE u.id = @id::uuid
FOR UPDATE OF u;

-- name: LockWorkspaceForDeletion :one
-- FOR UPDATE, unlike the Team's other changes, so a join or an insert that references the Workspace waits for this
-- transaction instead of slipping in before the delete.
SELECT id, owner_id FROM "exagram"."workspaces" WHERE id = @id::uuid FOR UPDATE;

-- name: CountLiveMembers :one
-- Its own statement, after the lock: a count inside the locking SELECT would read the snapshot from before a join
-- the lock waited for.
SELECT count(*)::int AS live_members FROM "exagram"."memberships"
WHERE workspace_id = @workspace_id::uuid AND removed_at IS NULL AND invited_at IS NULL;

-- name: LockWorkspaceArtifacts :exec
-- FOR UPDATE blocks a finalize, whose Revision insert takes KEY SHARE on its Artifact, so the storage keys listed
-- next are every key the delete removes.
SELECT id FROM "exagram"."artifacts" WHERE workspace_id = @workspace_id::uuid FOR UPDATE;

-- name: MarkWorkspaceArtifactsRemoved :exec
-- Fires each Artifact's `removed` change before the rows go, so open pages and Link pages drop it.
UPDATE "exagram"."artifacts" SET deleted_at = now()
WHERE workspace_id = @workspace_id::uuid AND deleted_at IS NULL;

-- name: ListWorkspaceStorageKeys :many
SELECT DISTINCT r.storage_key
FROM "exagram"."revisions" r
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
WHERE a.workspace_id = @workspace_id::uuid;

-- name: DeleteWorkspaceArtifacts :exec
-- Revisions, Grants, Links, Unlocks, Access Requests, Comments and their previews and text go with each Artifact.
DELETE FROM "exagram"."artifacts" WHERE workspace_id = @workspace_id::uuid;

-- name: DeleteWorkspaceProjects :exec
-- Project Grants, Connection folders, muted folders and pending uploads into a Project go with it.
DELETE FROM "exagram"."projects" WHERE workspace_id = @workspace_id::uuid;

-- name: DeleteWorkspaceConnections :exec
-- A Connection that wrote a Revision that still exists, or made a Ledger call, stays revoked so the Revision keeps
-- its Author and Audit its actor; the Workspace then stays too, empty.
DELETE FROM "exagram"."connections" c
WHERE c.workspace_id = @workspace_id::uuid
  AND NOT EXISTS (SELECT 1 FROM "exagram"."revisions" r WHERE r.author_connection_id = c.id)
  AND NOT EXISTS (
    SELECT 1 FROM "exagram"."ledger_calls" l WHERE l.principal_kind = 'connection' AND l.principal_id = c.id
  );

-- name: DeleteWorkspaceSessions :exec
DELETE FROM "exagram"."sessions" WHERE workspace_id = @workspace_id::uuid;

-- name: WorkspaceHasConnections :one
SELECT EXISTS (SELECT 1 FROM "exagram"."connections" WHERE workspace_id = @workspace_id::uuid)::boolean AS referenced;

-- name: DeleteWorkspaceMemberships :exec
DELETE FROM "exagram"."memberships" WHERE workspace_id = @workspace_id::uuid;

-- name: DeleteWorkspace :exec
-- Its Groups, Invites, Join Requests, Allowed Domains, Restricted Shares list and Reset Links go with it.
DELETE FROM "exagram"."workspaces" WHERE id = @workspace_id::uuid;

-- name: DeleteGrantsHeldByUser :exec
DELETE FROM "exagram"."grants" WHERE grantee_id = @user_id::uuid;

-- name: DeleteGroupMembershipsOfUser :exec
DELETE FROM "exagram"."group_members" WHERE user_id = @user_id::uuid;

-- name: RevokeLinksCreatedByUser :exec
UPDATE "exagram"."links" SET revoked_at = now() WHERE created_by = @user_id::uuid AND revoked_at IS NULL;

-- name: RevokeConnectionsOfUser :many
UPDATE "exagram"."connections" SET revoked_at = now()
WHERE user_id = @user_id::uuid AND revoked_at IS NULL
RETURNING id, oidc_grant_id;

-- name: DeleteSessionsOfUser :exec
DELETE FROM "exagram"."sessions" WHERE user_id = @user_id::uuid;

-- name: DeleteAccessRequestsByUser :exec
DELETE FROM "exagram"."access_requests" WHERE requester_id = @user_id::uuid;

-- name: DeletePasswordResetsOfUser :exec
DELETE FROM "exagram"."password_resets" WHERE user_id = @user_id::uuid OR created_by = @user_id::uuid;

-- name: DeleteInvitesOfUser :exec
-- Invites they sent anywhere, and Invites addressed to them.
DELETE FROM "exagram"."workspace_invites" WHERE invited_by = @user_id::uuid OR email = @email::citext;

-- name: DeleteJoinRequestsOfUser :exec
DELETE FROM "exagram"."join_requests" WHERE user_id = @user_id::uuid OR email = @email::citext;

-- name: DeleteEmailSignInsOfUser :exec
DELETE FROM "exagram"."email_sign_ins" WHERE email = @email::citext;

-- name: DeleteSettingsOfUser :exec
-- Notification Preferences, muted folders, and Notification Email confirmations and deliveries.
WITH preferences AS (
	DELETE FROM "exagram"."notification_preferences" WHERE user_id = @user_id::uuid RETURNING user_id
), muted AS (
	DELETE FROM "exagram"."notification_muted_projects" WHERE user_id = @user_id::uuid RETURNING user_id
), confirmations AS (
	DELETE FROM "exagram"."notification_email_confirmations" WHERE user_id = @user_id::uuid RETURNING user_id
)
DELETE FROM "exagram"."notification_email_deliveries" WHERE user_id = @user_id::uuid;

-- name: DeleteIdentitiesOfUser :exec
DELETE FROM "exagram"."user_identities" WHERE user_id = @user_id::uuid;

-- name: TombstoneUser :exec
-- The row stays so Revisions, Comments, Grants and Links they made, and Ledger rows, keep a name. The address moves
-- to a reserved one no mail reaches, so the real one can make a new account.
UPDATE "exagram"."users"
SET email = 'deleted-' || id::text || '@deleted.invalid',
    name = @name::text,
    password_hash = NULL,
    email_proven_legacy = false,
    unclaimed = false
WHERE id = @user_id::uuid;
