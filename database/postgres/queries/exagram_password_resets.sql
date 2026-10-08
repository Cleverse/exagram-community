-- name: UpsertPasswordReset :one
-- One Reset Link per account: a new one replaces the old token, which stops working.
INSERT INTO "exagram"."password_resets" (user_id, token_hash, created_by, expires_at)
VALUES (@user_id::uuid, @token_hash::text, sqlc.narg('created_by')::uuid, @expires_at::timestamptz)
ON CONFLICT (user_id) DO UPDATE
SET token_hash = EXCLUDED.token_hash, created_by = EXCLUDED.created_by, created_at = now(),
    expires_at = EXCLUDED.expires_at
RETURNING id, expires_at;

-- name: GetPasswordResetPreviewByTokenHash :one
SELECT u.email::text AS email, w.name AS workspace_name
FROM "exagram"."password_resets" r
JOIN "exagram"."users" u ON u.id = r.user_id
JOIN "exagram"."workspaces" w ON w.id = u.workspace_id
WHERE r.token_hash = @token_hash::text AND r.expires_at > now();

-- name: TakePasswordResetByTokenHash :one
-- Using a Reset Link deletes it inside the reset's transaction, so of two uses of one token only the
-- first gets a row. created_by says who made it: null is the server operator's command.
DELETE FROM "exagram"."password_resets" r
USING "exagram"."users" u
WHERE r.token_hash = @token_hash::text AND r.expires_at > now() AND u.id = r.user_id
RETURNING r.user_id, r.created_by, u.email::text AS email;

-- name: LockResetHolderMemberships :many
SELECT m.user_id, m.workspace_id
FROM "exagram"."password_resets" p
JOIN "exagram"."memberships" m ON m.user_id = p.user_id
WHERE p.token_hash = @token_hash::text
ORDER BY m.workspace_id
FOR NO KEY UPDATE OF m;
