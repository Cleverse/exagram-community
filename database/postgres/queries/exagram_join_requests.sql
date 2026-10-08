-- name: OpenJoinRequestKeepingCredential :one
INSERT INTO "exagram"."join_requests" (workspace_id, email, name, password_hash, google_subject, via, invited_by)
VALUES (@workspace_id::uuid, @email::citext, @name::text, sqlc.narg('password_hash')::text,
	sqlc.narg('google_subject')::text, @via::text, sqlc.narg('invited_by')::uuid)
ON CONFLICT (workspace_id, email) DO UPDATE
SET name = EXCLUDED.name,
	password_hash = CASE WHEN "join_requests".declined_at IS NULL THEN "join_requests".password_hash
		ELSE EXCLUDED.password_hash END,
	google_subject = CASE WHEN "join_requests".declined_at IS NULL THEN "join_requests".google_subject
		ELSE EXCLUDED.google_subject END,
	via = EXCLUDED.via, invited_by = EXCLUDED.invited_by, declined_at = NULL
WHERE "join_requests".declined_at IS NOT NULL
	OR (("join_requests".password_hash IS NULL) = (EXCLUDED.password_hash IS NULL)
		AND "join_requests".google_subject IS NOT DISTINCT FROM EXCLUDED.google_subject)
RETURNING password_hash;

-- name: GetJoinRequestForEmail :one
SELECT r.declined_at IS NOT NULL AS declined
FROM "exagram"."join_requests" r
WHERE r.workspace_id = @workspace_id::uuid AND r.email = @email::citext;

-- name: ListOpenJoinRequestCredentialsForEmail :many
SELECT r.password_hash
FROM "exagram"."join_requests" r
WHERE r.email = @email::citext AND r.declined_at IS NULL
ORDER BY r.created_at, r.id;

-- name: DeleteJoinRequestsForEmail :many
DELETE FROM "exagram"."join_requests" WHERE email = @email::citext
RETURNING id;
