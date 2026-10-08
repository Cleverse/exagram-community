-- name: InsertWorkspace :one
INSERT INTO "exagram"."workspaces" (name) VALUES (@name) RETURNING *;

-- name: GetWorkspaceKind :one
SELECT kind FROM "exagram"."workspaces" WHERE id = @id::uuid;

-- name: GetWorkspaceById :one
SELECT * FROM "exagram"."workspaces" WHERE id = @id;

-- name: CountUsers :one
SELECT count(*)::int AS total FROM "exagram"."users";

-- name: LockSignUps :exec
-- Serialises account creation for the rest of the transaction, so "is this the first account" is
-- answered once even when two sign-ups race on an empty install.
SELECT pg_advisory_xact_lock(hashtext('exagram:sign-up'));

-- name: SetWorkspaceOwner :exec
UPDATE "exagram"."workspaces" SET owner_id = @owner_id::uuid WHERE id = @id::uuid;

-- name: InsertUser :one
WITH created AS (
	INSERT INTO "exagram"."users" (workspace_id, email, name, password_hash, is_admin)
	VALUES (@workspace_id, @email, @name, sqlc.narg('password_hash'), @is_admin)
	RETURNING *
), membership AS (
	INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, created_at)
	SELECT c.id, c.workspace_id, w.kind, CASE WHEN c.is_admin THEN 'admin' ELSE 'member' END, c.created_at
	FROM created c JOIN "exagram"."workspaces" w ON w.id = c.workspace_id
)
SELECT * FROM created;

-- name: GetUserByEmail :one
SELECT u.*, EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
) AS google_linked, "exagram".has_live_membership(u.id)::boolean AS has_live_membership
FROM "exagram"."users" u
WHERE u.email = @email;

-- name: ClearPasswordHashIfMatches :one
UPDATE "exagram"."users"
SET password_hash = NULL
WHERE id = @id AND password_hash = @expected_hash
RETURNING id;

-- name: SetPasswordHashIfMatches :one
-- A password sign-up with an Admin's Join Link claims the invited Member's row.
UPDATE "exagram"."users"
SET password_hash = @password_hash::text
WHERE id = @id AND password_hash = @expected_hash
RETURNING id;

-- name: LockPersonMemberships :many
-- Taken before any statement that writes both a person's memberships and their users row, so every such
-- writer locks memberships first, in one order.
SELECT m.workspace_id FROM "exagram"."memberships" m
WHERE m.user_id = @id::uuid
ORDER BY m.workspace_id
FOR NO KEY UPDATE;

-- name: MarkInvitedUserClaimed :exec
-- The invited Member signed in: no longer pending, joined as of now, and the email that stood in for
-- their name gives way to the one Google knows.
WITH membership AS (
	UPDATE "exagram"."memberships" SET invited_at = NULL, joined_at = now()
	WHERE user_id = @id AND workspace_id = @workspace_id::uuid AND invited_at IS NOT NULL
	RETURNING user_id
), other_team_invitations AS (
	DELETE FROM "exagram"."memberships"
	WHERE user_id = @id AND workspace_id <> @workspace_id::uuid AND invited_at IS NOT NULL AND removed_at IS NULL
)
UPDATE "exagram"."users"
SET invited_at = CASE WHEN workspace_id = @workspace_id::uuid THEN NULL ELSE invited_at END,
    joined_at = CASE WHEN workspace_id = @workspace_id::uuid AND invited_at IS NOT NULL THEN now() ELSE joined_at END,
    name = CASE WHEN name = email::text AND sqlc.narg('name')::text IS NOT NULL THEN sqlc.narg('name')::text ELSE name END
WHERE id = @id AND EXISTS (SELECT 1 FROM membership);

-- name: PromoteUserToAdmin :exec
-- An Invite with the admin role claimed an invited Member's row.
WITH membership AS (
	UPDATE "exagram"."memberships" SET role = 'admin'
	WHERE user_id = @id::uuid AND workspace_id = @workspace_id::uuid
	RETURNING user_id
)
UPDATE "exagram"."users" SET is_admin = true
WHERE id = @id::uuid AND workspace_id = @workspace_id::uuid AND EXISTS (SELECT 1 FROM membership);

-- name: JoinWorkspace :exec
WITH membership AS (
	INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, joined_at)
	SELECT @user_id::uuid, w.id, w.kind, @role::text, now()
	FROM "exagram"."workspaces" w WHERE w.id = @workspace_id::uuid
	ON CONFLICT (user_id, workspace_id) DO UPDATE
	SET removed_at = NULL, invited_at = NULL, role = EXCLUDED.role, joined_at = now()
	RETURNING user_id
), other_team_invitations AS (
	DELETE FROM "exagram"."memberships"
	WHERE user_id = @user_id::uuid AND workspace_id <> @workspace_id::uuid AND invited_at IS NOT NULL
	  AND removed_at IS NULL
)
UPDATE "exagram"."users" SET workspace_id = @workspace_id::uuid, is_admin = (@role::text = 'admin'), removed_at = NULL
WHERE id = @user_id::uuid AND EXISTS (SELECT 1 FROM membership);

-- name: AdoptInvitedWorkspace :one
UPDATE "exagram"."users" u SET workspace_id = @workspace_id::uuid
WHERE u.id = @id::uuid AND u.invited_at IS NOT NULL AND EXISTS (
	SELECT 1 FROM "exagram"."memberships" m
	WHERE m.user_id = u.id AND m.workspace_id = @workspace_id::uuid AND m.invited_at IS NOT NULL
	  AND m.removed_at IS NULL
)
RETURNING u.id;

-- name: DeleteUnclaimedInvitedUser :one
-- Someone invited by email signs in with Google asking for another Workspace: their choice wins, and
-- the unclaimed row goes with the Grants it held.
DELETE FROM "exagram"."users"
WHERE id = @id AND invited_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "exagram"."user_identities" i WHERE i.user_id = "exagram"."users".id)
RETURNING id;

-- name: GetUserByIdentity :one
SELECT user_id, provider, subject, email
FROM "exagram"."user_identities"
WHERE provider = @provider AND subject = @subject;

-- name: GetUserIdentityEmail :one
SELECT email::text AS email
FROM "exagram"."user_identities"
WHERE user_id = @user_id::uuid AND provider = @provider;

-- name: InsertUserIdentity :exec
INSERT INTO "exagram"."user_identities" (user_id, provider, subject, email)
VALUES (@user_id, @provider, @subject, @email);

-- name: UpdateUserIdentityEmail :exec
UPDATE "exagram"."user_identities" SET email = @email
WHERE provider = @provider AND subject = @subject;

-- name: GetUserById :one
SELECT u.id, u.workspace_id, u.email, u.name, u.password_hash, (m.role = 'admin')::boolean AS is_admin,
       u.created_at, m.invited_at, m.last_seen_at, m.joined_at,
       EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
) AS google_linked
FROM "exagram"."users" u
JOIN "exagram"."memberships" m ON m.user_id = u.id AND m.workspace_id = u.workspace_id
WHERE u.id = @id AND "exagram".live_member(u.id, u.workspace_id);

-- name: GetUserInWorkspace :one
SELECT u.id, m.workspace_id, u.email, u.name, u.password_hash, (m.role = 'admin')::boolean AS is_admin,
       u.created_at, m.invited_at, m.last_seen_at, m.joined_at,
       EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
) AS google_linked
FROM "exagram"."users" u
JOIN "exagram"."memberships" m ON m.user_id = u.id AND m.workspace_id = @workspace_id::uuid
WHERE u.id = @id::uuid AND "exagram".live_member(u.id, @workspace_id::uuid);

-- name: InsertSession :one
INSERT INTO "exagram"."sessions" (user_id, token_hash, expires_at, workspace_id)
SELECT m.user_id, @token_hash, @expires_at, m.workspace_id
FROM "exagram"."memberships" m
WHERE m.user_id = @user_id AND "exagram".live_member(m.user_id, m.workspace_id)
ORDER BY (m.kind = 'team') DESC, m.workspace_id
LIMIT 1
RETURNING *;

-- name: GetUserBySessionTokenHash :one
SELECT u.id, s.id AS session_id, s.workspace_id, u.email, u.name, u.password_hash, (m.role = 'admin')::boolean AS is_admin,
       u.created_at, m.invited_at, m.last_seen_at, m.joined_at,
       EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
) AS google_linked
FROM "exagram"."sessions" s
JOIN "exagram"."users" u ON u.id = s.user_id
JOIN "exagram"."memberships" m ON m.user_id = u.id AND m.workspace_id = s.workspace_id
WHERE s.token_hash = @token_hash AND s.expires_at > now()
  AND "exagram".live_member(u.id, s.workspace_id);

-- name: TouchUserLastSeen :exec
WITH membership AS (
	UPDATE "exagram"."memberships" SET last_seen_at = now()
	WHERE user_id = @id AND workspace_id = @workspace_id::uuid AND removed_at IS NULL
	  AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')
	RETURNING user_id
)
UPDATE "exagram"."users" SET last_seen_at = now()
WHERE id = @id AND workspace_id = @workspace_id::uuid AND EXISTS (SELECT 1 FROM membership)
  AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes');

-- name: LockMembershipForSwitch :one
-- The first step of a switch: the share lock a removal waits on, so a removal that is committing finishes first and
-- the next statement sees it. No row when the person holds no membership of the Workspace at all.
SELECT m.workspace_id FROM "exagram"."memberships" m
WHERE m.user_id = @user_id::uuid AND m.workspace_id = @workspace_id::uuid
FOR SHARE;

-- name: SwitchSessionWorkspace :one
-- The second step, in the same transaction and so after the lock: moves one session only to a Workspace its person
-- is a live member of.
UPDATE "exagram"."sessions" s SET workspace_id = @workspace_id::uuid
WHERE s.id = @session_id::uuid AND s.user_id = @user_id::uuid
  AND "exagram".live_member(@user_id::uuid, @workspace_id::uuid)
RETURNING s.workspace_id;

-- name: ListLiveWorkspaces :many
SELECT w.id, w.kind, w.name, m.role
FROM "exagram"."memberships" m
JOIN "exagram"."workspaces" w ON w.id = m.workspace_id
WHERE m.user_id = @user_id::uuid AND "exagram".live_member(m.user_id, m.workspace_id)
ORDER BY (w.kind = 'personal') DESC, w.name, w.id;

-- name: DeleteSessionByTokenHash :exec
DELETE FROM "exagram"."sessions" WHERE token_hash = @token_hash;

-- name: SetPasswordHash :one
-- A Reset Link replaces a forgotten password. Only accounts that already have one get a link (ADR 0034);
-- an invited Member's row is not an account yet.
UPDATE "exagram"."users"
SET password_hash = @password_hash::text
WHERE id = @id::uuid AND invited_at IS NULL
RETURNING id;

-- name: DeleteSessionsForUser :many
-- Ends every web session of one person. Connections are OAuth grants, not sessions, and stay.
DELETE FROM "exagram"."sessions" WHERE user_id = @user_id::uuid
RETURNING id;
