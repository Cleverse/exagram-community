-- name: OpenJoinRequestKeepingCredential :one
INSERT INTO "exagram"."join_requests" (workspace_id, email, name, password_hash, google_subject, via, invited_by, email_verified,
	apple_subject)
VALUES (@workspace_id::uuid, @email::citext, @name::text, sqlc.narg('password_hash')::text,
	sqlc.narg('google_subject')::text, @via::text, sqlc.narg('invited_by')::uuid,
	@email_verified::boolean, sqlc.narg('apple_subject')::text)
ON CONFLICT (workspace_id, email) DO UPDATE
SET name = EXCLUDED.name, user_id = NULL,
	password_hash = CASE WHEN "join_requests".declined_at IS NULL THEN "join_requests".password_hash
		ELSE EXCLUDED.password_hash END,
	google_subject = CASE WHEN "join_requests".declined_at IS NULL THEN "join_requests".google_subject
		ELSE EXCLUDED.google_subject END,
	apple_subject = CASE WHEN "join_requests".declined_at IS NULL THEN "join_requests".apple_subject
		ELSE EXCLUDED.apple_subject END,
	email_verified = CASE WHEN "join_requests".declined_at IS NULL THEN "join_requests".email_verified
		ELSE EXCLUDED.email_verified END,
	via = EXCLUDED.via, invited_by = EXCLUDED.invited_by, declined_at = NULL
WHERE "join_requests".declined_at IS NOT NULL
	OR ("join_requests".user_id IS NULL
		AND ("join_requests".password_hash IS NULL) = (EXCLUDED.password_hash IS NULL)
		AND "join_requests".google_subject IS NOT DISTINCT FROM EXCLUDED.google_subject
		AND "join_requests".apple_subject IS NOT DISTINCT FROM EXCLUDED.apple_subject
		AND "join_requests".email_verified = EXCLUDED.email_verified)
RETURNING password_hash;

-- name: OpenJoinRequestForAccount :one
INSERT INTO "exagram"."join_requests" (workspace_id, email, name, password_hash, google_subject, via, invited_by, user_id)
VALUES (@workspace_id::uuid, @email::citext, @name::text, sqlc.narg('password_hash')::text,
	sqlc.narg('google_subject')::text, @via::text, sqlc.narg('invited_by')::uuid, @user_id::uuid)
ON CONFLICT (workspace_id, email) DO UPDATE
SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, google_subject = EXCLUDED.google_subject,
	via = EXCLUDED.via, invited_by = EXCLUDED.invited_by, user_id = EXCLUDED.user_id, declined_at = NULL
WHERE "join_requests".declined_at IS NOT NULL OR "join_requests".user_id = EXCLUDED.user_id
RETURNING id;

-- name: GetJoinRequestWithoutAccountForEmail :one
SELECT r.declined_at IS NOT NULL AS declined
FROM "exagram"."join_requests" r
WHERE r.workspace_id = @workspace_id::uuid AND r.email = @email::citext AND r.user_id IS NULL;

-- name: ListOpenJoinRequestCredentialsWithoutAccount :many
SELECT r.password_hash
FROM "exagram"."join_requests" r
WHERE r.email = @email::citext AND r.declined_at IS NULL AND r.user_id IS NULL
ORDER BY r.created_at, r.id;

-- name: DeleteJoinRequestsForAccount :many
DELETE FROM "exagram"."join_requests" r USING "exagram"."users" u
WHERE u.id = @user_id::uuid AND (r.user_id = u.id OR (r.user_id IS NULL AND r.email = u.email))
RETURNING r.id;
