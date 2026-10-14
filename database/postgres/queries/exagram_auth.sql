-- name: InsertWorkspace :one
INSERT INTO "exagram"."workspaces" (name) VALUES (@name) RETURNING *;

-- name: InsertPersonalWorkspace :one
WITH created AS (SELECT "exagram".create_personal_workspace(NULL) AS id)
SELECT id::uuid AS id FROM created;

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
	INSERT INTO "exagram"."users" (email, name, password_hash)
	VALUES (@email, @name, sqlc.narg('password_hash'))
	RETURNING id, email, name, password_hash, created_at
), membership AS (
	INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, created_at)
	SELECT c.id, @workspace_id::uuid, (SELECT w.kind FROM "exagram"."workspaces" w WHERE w.id = @workspace_id::uuid),
		CASE WHEN @is_admin::boolean THEN 'admin' ELSE 'member' END, c.created_at
	FROM created c
	RETURNING workspace_id, role
)
SELECT c.id, m.workspace_id, c.email, c.name, c.password_hash, (m.role = 'admin')::boolean AS is_admin, c.created_at
FROM created c CROSS JOIN membership m;

-- name: GetUserByEmail :one
SELECT u.id, u.email, u.name, u.password_hash, u.created_at, EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
)::boolean AS google_linked, "exagram".has_live_membership(u.id)::boolean AS has_live_membership,
"exagram".live_team_of(u.id) AS live_team_id, "exagram".email_proven(u.id)::boolean AS email_proven,
u.unclaimed,
(SELECT m.workspace_id FROM "exagram"."memberships" m
 WHERE m.user_id = u.id AND m.invited_at IS NOT NULL AND m.removed_at IS NULL AND u.unclaimed
 ORDER BY m.created_at, m.workspace_id LIMIT 1) AS earliest_inviting_workspace_id
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

-- name: PromoteUserToAdmin :exec
-- An Invite with the admin role claimed an invited Member's row.
UPDATE "exagram"."memberships" SET role = 'admin'
WHERE user_id = @id::uuid AND workspace_id = @workspace_id::uuid;

-- name: JoinWorkspace :exec
WITH other_team_invitations AS (
	DELETE FROM "exagram"."memberships"
	WHERE user_id = @user_id::uuid AND workspace_id <> @workspace_id::uuid AND invited_at IS NOT NULL
	  AND removed_at IS NULL
)
INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, joined_at)
SELECT @user_id::uuid, w.id, w.kind, @role::text, now()
FROM "exagram"."workspaces" w WHERE w.id = @workspace_id::uuid
ON CONFLICT (user_id, workspace_id) DO UPDATE
SET removed_at = NULL, invited_at = NULL, role = EXCLUDED.role, joined_at = now();

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
SELECT u.id, m.workspace_id, u.email, u.name, u.password_hash, (m.role = 'admin')::boolean AS is_admin,
       u.created_at, m.invited_at, m.last_seen_at, m.joined_at,
       EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
) AS google_linked
FROM "exagram"."users" u
CROSS JOIN LATERAL (
	SELECT x.* FROM "exagram"."memberships" x
	WHERE x.user_id = u.id AND "exagram".live_member(x.user_id, x.workspace_id)
	ORDER BY (x.kind = 'team') DESC, x.workspace_id
	LIMIT 1
) m
WHERE u.id = @id;

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

-- name: InsertSessionForPassword :one
-- A password sign-in's session, only while the account still holds the hash the password was checked against. The
-- share lock makes a Google adoption that clears the hash either wait for this insert, and then end its session, or
-- commit first, and then this inserts nothing.
WITH holder AS (
	SELECT u.id FROM "exagram"."users" u
	WHERE u.id = @user_id AND u.password_hash = @password_hash::text
	FOR SHARE
)
INSERT INTO "exagram"."sessions" (user_id, token_hash, expires_at, workspace_id)
SELECT m.user_id, @token_hash, @expires_at, m.workspace_id
FROM "exagram"."memberships" m
JOIN holder h ON h.id = m.user_id
WHERE "exagram".live_member(m.user_id, m.workspace_id)
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
UPDATE "exagram"."memberships" SET last_seen_at = now()
WHERE user_id = @id AND workspace_id = @workspace_id::uuid AND removed_at IS NULL
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
-- A Reset Link replaces a forgotten password. Only accounts that already have one get a link;
-- an invited Member's row is not an account yet.
UPDATE "exagram"."users"
SET password_hash = @password_hash::text
WHERE id = @id::uuid AND NOT unclaimed
RETURNING id;

-- name: DeleteSessionsForUser :many
-- Ends every web session of one person. Connections are OAuth grants, not sessions, and stay.
DELETE FROM "exagram"."sessions" WHERE user_id = @user_id::uuid
RETURNING id;

-- name: GetLiveTeamId :one
SELECT "exagram".live_team_of(@user_id::uuid)::uuid AS workspace_id;

-- name: LockAccountForJoin :one
SELECT u.id, "exagram".live_team_of(u.id)::uuid AS live_team_id,
	(sqlc.narg('password_hash')::text IS NOT NULL AND u.password_hash = sqlc.narg('password_hash')::text)::boolean
		AS holds_password
FROM "exagram"."users" u
WHERE u.id = @user_id::uuid AND NOT u.unclaimed
FOR NO KEY UPDATE OF u;

-- name: HoldsGoogleIdentity :one
SELECT EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = @user_id::uuid AND i.provider = 'google' AND i.subject = @subject::text
)::boolean AS held;

-- name: IsBareAccount :one
SELECT "exagram".bare_account(@id::uuid)::boolean AS bare;

-- name: ClaimUnclaimedAccount :one
-- A row someone shared with becomes an account at home in its own Personal Workspace, leaving every Workspace that only
-- invited it. Its Grants stay as they were made: a dormant one waits for the email to be proven (000044).
SELECT "exagram".claim_unclaimed_account(@id::uuid, sqlc.narg('name')::text, sqlc.narg('password_hash')::text)::uuid
	AS id;

-- name: EndUnprovenAccess :one
-- Google adopting an account nobody had proven ends what whoever held its password could still use: its sessions,
-- Reset Links, Connections with their OAuth grants, the Links it made, its open Join Requests and any sign-in
-- identity it linked, which could not have been for its address. Its files stay.
WITH sessions AS (
	DELETE FROM "exagram"."sessions" WHERE user_id = @user_id::uuid RETURNING 1
), resets AS (
	DELETE FROM "exagram"."password_resets" WHERE user_id = @user_id::uuid RETURNING 1
), connections AS (
	UPDATE "exagram"."connections" SET revoked_at = now()
	WHERE user_id = @user_id::uuid AND revoked_at IS NULL
	RETURNING oidc_grant_id
), oidc AS (
	DELETE FROM "exagram"."oidc_payloads" o USING connections c
	WHERE c.oidc_grant_id IS NOT NULL AND (o.grant_id = c.oidc_grant_id OR (o.type = 'Grant' AND o.id = c.oidc_grant_id))
	RETURNING 1
), links AS (
	UPDATE "exagram"."links" SET revoked_at = now()
	WHERE created_by = @user_id::uuid AND revoked_at IS NULL
	RETURNING 1
), requests AS (
	DELETE FROM "exagram"."join_requests" r USING "exagram"."users" u
	WHERE u.id = @user_id::uuid AND (r.user_id = u.id OR (r.user_id IS NULL AND r.email = u.email))
		AND r.declined_at IS NULL
	RETURNING 1
), identities AS (
	DELETE FROM "exagram"."user_identities" WHERE user_id = @user_id::uuid RETURNING 1
)
SELECT (SELECT count(*) FROM sessions)::int AS sessions, (SELECT count(*) FROM resets)::int AS resets,
       (SELECT count(*) FROM connections)::int AS connections, (SELECT count(*) FROM oidc)::int AS oidc_payloads,
       (SELECT count(*) FROM links)::int AS links, (SELECT count(*) FROM requests)::int AS join_requests,
       (SELECT count(*) FROM identities)::int AS identities;

-- name: LockUnclaimedAccount :one
SELECT "exagram".lock_unclaimed_account(@id::uuid)::boolean AS unclaimed;

-- name: SleepUnvouchedGrants :one
-- A password claim proves no email, so the claimed row's Grants that nobody vouches for wait for proof, like a share
-- made to it after 000044. Only those made before 000044 can still be awake here.
WITH slept AS (
	UPDATE "exagram"."grants" g SET dormant = true
	WHERE g.grantee_id = @user_id::uuid AND NOT g.dormant
	  AND NOT "exagram".email_proven(@user_id::uuid)
	  AND NOT "exagram".live_member(@user_id::uuid, COALESCE(
		(SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = g.artifact_id),
		(SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = g.project_id)
	  ))
	RETURNING 1
)
SELECT count(*)::int AS slept FROM slept;

-- name: WakeGrants :one
SELECT "exagram".wake_grants(@user_id::uuid)::int AS woken;

-- name: RecordEmailProof :exec
-- An Email Sign-in proved the account's address. Kept as a confirmed Notification Email for that address,
-- which is what "exagram".email_proven reads, under a token hash no link can carry. Adds nothing once it is proven.
-- No confirmation email went out for it, so it is dated -infinity and spends none of their send limits.
INSERT INTO "exagram"."notification_email_confirmations"
	("user_id", "email", "canonical_email", "token_hash", "sent_at", "expires_at", "confirmed_at")
SELECT u.id, lower(u.email::text), "exagram".canonical_email_address(u.email::text),
       'email-sign-in:' || gen_random_uuid()::text, '-infinity', now(), now()
FROM "exagram"."users" u
WHERE u.id = @user_id::uuid AND NOT "exagram".notification_email_verified(u.id);
