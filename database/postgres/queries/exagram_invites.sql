-- name: InsertWorkspaceInvite :one
-- A null id means a usable Invite for that email already exists; a dead one is replaced.
WITH inviter AS (
	SELECT m.user_id AS id FROM "exagram"."memberships" m
	JOIN "exagram"."workspaces" w ON w.id = m.workspace_id
	WHERE m.user_id = @invited_by::uuid AND m.workspace_id = @workspace_id::uuid AND m.removed_at IS NULL AND m.invited_at IS NULL
		AND CASE @via::text
			WHEN 'admin_invite' THEN m.role = 'admin'
			WHEN 'member_invite' THEN @role::text = 'member' AND w.member_invites
			ELSE false
		END
	FOR SHARE OF m
), inserted AS (
	INSERT INTO "exagram"."workspace_invites" (workspace_id, email, role, token_hash, invited_by, expires_at, via)
	SELECT @workspace_id::uuid, @email::citext, @role::text, @token_hash::text, inviter.id, @expires_at::timestamptz,
		@via::text
	FROM inviter
	ON CONFLICT (workspace_id, email) DO UPDATE
	SET role = EXCLUDED.role, token_hash = EXCLUDED.token_hash, invited_by = EXCLUDED.invited_by,
	    expires_at = EXCLUDED.expires_at, via = EXCLUDED.via, created_at = now()
	WHERE NOT "exagram"."invite_usable"(
		"workspace_invites".invited_by, "workspace_invites".workspace_id, "workspace_invites".role, "workspace_invites".via
	)
	RETURNING id, email::text AS email, role, via, created_at, expires_at
)
SELECT EXISTS (SELECT 1 FROM inviter) AS inviter_allowed,
	i.id::uuid AS id, i.email::text AS email, i.role::text AS role, i.via::text AS via,
	i.created_at::timestamptz AS created_at, i.expires_at::timestamptz AS expires_at
FROM (SELECT 1) AS one
LEFT JOIN inserted i ON true;

-- name: ListWorkspaceInvites :many
-- Expired ones too: "Copy new link" is how an Admin brings one back. Never the token hash.
SELECT i.id, i.email::text AS email, i.role, i.via, i.created_at, i.expires_at, u.name AS invited_by_name
FROM "exagram"."workspace_invites" i
JOIN "exagram"."users" u ON u.id = i.invited_by
WHERE i.workspace_id = @workspace_id::uuid AND "exagram"."invite_usable"(i.invited_by, i.workspace_id, i.role, i.via)
ORDER BY i.created_at DESC, i.id DESC;

-- name: RenewWorkspaceInvite :one
-- A new token and a new expiry; the old Join Link stops working. The renewing Admin becomes the inviter, so the
-- Invite is an admin_invite from here on. held_seat says whether it held a Seat before this renewal.
UPDATE "exagram"."workspace_invites" i
SET token_hash = @token_hash::text, expires_at = @expires_at::timestamptz, invited_by = @invited_by::uuid,
	via = 'admin_invite'
FROM (
	SELECT p.id, (p.expires_at > now() AND "exagram"."invite_usable"(p.invited_by, p.workspace_id, p.role, p.via)) AS held_seat
	FROM "exagram"."workspace_invites" p
	WHERE p.id = @id::uuid AND p.workspace_id = @workspace_id::uuid
	FOR UPDATE
) prev
WHERE i.id = prev.id
  AND EXISTS (
	SELECT 1 FROM "exagram"."memberships" m
	WHERE m.user_id = @invited_by::uuid AND m.workspace_id = @workspace_id::uuid AND m.removed_at IS NULL AND m.invited_at IS NULL
	  AND m.role = 'admin'
	FOR SHARE
  )
RETURNING i.id, i.email::text AS email, i.role, i.via, i.created_at, i.expires_at,
	prev.held_seat::boolean AS held_seat;

-- name: CountInviteRenewalsBySenderSince :one
-- Each renewal can mail the invited address again, so renewals have their own cap, apart from the cap on new invited
-- Members.
SELECT count(*)::int AS total
FROM "exagram"."ledger_calls" c
WHERE c.principal_kind = 'user'
	AND c.principal_id = @sender_id::uuid
	AND c.action = 'workspace.invite.renew'
	AND c.started_at >= @since::timestamptz;

-- name: DeleteWorkspaceInvite :one
DELETE FROM "exagram"."workspace_invites"
WHERE id = @id::uuid AND workspace_id = @workspace_id::uuid
RETURNING id, email::text AS email;

-- name: IsWorkspaceInviteCurrent :one
SELECT EXISTS (
	SELECT 1 FROM "exagram"."workspace_invites"
	WHERE id = @id::uuid AND token_hash = @token_hash::text AND expires_at > now()
		AND "exagram"."invite_usable"(invited_by, workspace_id, role, via)
)::boolean AS current;

-- name: GetInvitePreviewByTokenHash :one
SELECT i.email::text AS email, i.role, w.name AS workspace_name
FROM "exagram"."workspace_invites" i
JOIN "exagram"."workspaces" w ON w.id = i.workspace_id
WHERE i.token_hash = @token_hash::text AND i.expires_at > now() AND "exagram"."invite_usable"(i.invited_by, i.workspace_id, i.role, i.via);

-- name: GetInviteWorkspaceByTokenHash :one
SELECT workspace_id FROM "exagram"."workspace_invites"
WHERE token_hash = @token_hash::text AND expires_at > now() AND "exagram"."invite_usable"(invited_by, workspace_id, role, via);

-- name: GetPendingInviteWorkspaceByEmail :one
SELECT p.workspace_id FROM "exagram"."workspace_invites" p
WHERE p.email = @email::citext AND p.expires_at > now() AND "exagram"."invite_usable"(p.invited_by, p.workspace_id, p.role, p.via)
	AND (sqlc.narg('workspace_id')::uuid IS NULL OR p.workspace_id = sqlc.narg('workspace_id')::uuid)
ORDER BY p.created_at DESC, p.id DESC
LIMIT 1;

-- name: TakeInviteByTokenHash :one
-- Accepting deletes the Invite inside the sign-up transaction, so of two sign-ups with one token only
-- the first gets a row; a refusal later in that transaction rolls the delete back.
DELETE FROM "exagram"."workspace_invites"
WHERE token_hash = @token_hash::text AND expires_at > now() AND "exagram"."invite_usable"(invited_by, workspace_id, role, via)
RETURNING id, workspace_id, email::text AS email, role, via, invited_by;

-- name: TakePendingInviteByEmail :one
-- A verified Google sign-up joins through the newest unexpired Invite for its email, token or not;
-- limited to one Workspace when the email already has an invited Member's row there.
DELETE FROM "exagram"."workspace_invites"
WHERE id = (
	SELECT p.id FROM "exagram"."workspace_invites" p
	WHERE p.email = @email::citext AND p.expires_at > now() AND "exagram"."invite_usable"(p.invited_by, p.workspace_id, p.role, p.via)
		AND (sqlc.narg('workspace_id')::uuid IS NULL OR p.workspace_id = sqlc.narg('workspace_id')::uuid)
	ORDER BY p.created_at DESC, p.id DESC
	LIMIT 1
)
RETURNING id, workspace_id, email::text AS email, role, via, invited_by;
