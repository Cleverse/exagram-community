-- name: UpsertPasswordReset :one
-- One Reset Link per account: a new one replaces the old token, which stops working.
-- An Admin's link names the Workspace they made it in; the server operator's names none.
INSERT INTO "exagram"."password_resets" (user_id, token_hash, created_by, workspace_id, expires_at)
VALUES (@user_id::uuid, @token_hash::text, sqlc.narg('created_by')::uuid, sqlc.narg('workspace_id')::uuid,
        @expires_at::timestamptz)
ON CONFLICT (user_id) DO UPDATE
SET token_hash = EXCLUDED.token_hash, created_by = EXCLUDED.created_by, workspace_id = EXCLUDED.workspace_id,
    created_at = now(), expires_at = EXCLUDED.expires_at
RETURNING id, expires_at;

-- name: GetPasswordResetPreviewByTokenHash :one
SELECT u.email::text AS email, w.name AS workspace_name
FROM "exagram"."password_resets" r
JOIN "exagram"."users" u ON u.id = r.user_id
JOIN "exagram"."workspaces" w ON w.id = COALESCE(r.workspace_id, "exagram".home_workspace(u.id))
WHERE r.token_hash = @token_hash::text AND r.expires_at > now();

-- name: TakePasswordResetByTokenHash :one
-- Using a Reset Link deletes it inside the reset's transaction, so of two uses of one token only the
-- first gets a row. created_by says who made it: null is the server operator's command. An Admin's link works only
-- while its maker is a live Admin of the link's Workspace, its holder a live member there who is no Admin, and the
-- holder neither uses Personal Workspace content the link would hand over nor has proven their email.
DELETE FROM "exagram"."password_resets" r
USING "exagram"."users" u
WHERE r.token_hash = @token_hash::text AND r.expires_at > now() AND u.id = r.user_id
RETURNING r.user_id, r.created_by, u.email::text AS email, r.workspace_id,
  (r.workspace_id IS NOT NULL
   AND "exagram".live_member(r.created_by, r.workspace_id)
   AND "exagram".live_member(r.user_id, r.workspace_id)
   AND EXISTS (SELECT 1 FROM "exagram"."memberships" maker
               WHERE maker.user_id = r.created_by AND maker.workspace_id = r.workspace_id AND maker.role = 'admin')
   AND NOT EXISTS (SELECT 1 FROM "exagram"."memberships" holder
                   WHERE holder.user_id = r.user_id AND holder.workspace_id = r.workspace_id AND holder.role = 'admin')
   AND NOT "exagram".admin_reset_refused(r.user_id, r.workspace_id)
  )::boolean AS admin_link_usable;

-- name: AdminResetRefused :one
SELECT "exagram".admin_reset_refused(@user_id::uuid, @workspace_id::uuid)::boolean AS refused;

-- name: LockResetHolderMemberships :many
SELECT m.user_id, m.workspace_id
FROM "exagram"."password_resets" p
JOIN "exagram"."memberships" m ON m.user_id = p.user_id
WHERE p.token_hash = @token_hash::text
ORDER BY m.workspace_id
FOR NO KEY UPDATE OF m;
