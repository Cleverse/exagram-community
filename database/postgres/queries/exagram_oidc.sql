-- name: UpsertOidcPayload :exec
INSERT INTO "exagram"."oidc_payloads" (id, type, payload, grant_id, user_code, uid, expires_at)
VALUES (
    @id::text, @type::text, @payload::jsonb,
    sqlc.narg('grant_id')::text, sqlc.narg('user_code')::text, sqlc.narg('uid')::text,
    sqlc.narg('expires_at')::timestamptz
)
ON CONFLICT (id, type) DO UPDATE
SET payload = excluded.payload,
    grant_id = excluded.grant_id,
    user_code = excluded.user_code,
    uid = excluded.uid,
    expires_at = excluded.expires_at;

-- name: FindOidcPayload :one
SELECT payload, consumed_at, expires_at FROM "exagram"."oidc_payloads"
WHERE id = @id::text AND type = @type::text;

-- name: FindOidcPayloadByUid :one
SELECT payload, consumed_at, expires_at FROM "exagram"."oidc_payloads"
WHERE uid = @uid::text AND type = @type::text;

-- name: FindOidcPayloadByUserCode :one
SELECT payload, consumed_at, expires_at FROM "exagram"."oidc_payloads"
WHERE user_code = @user_code::text AND type = @type::text;

-- name: ConsumeOidcPayload :one
UPDATE "exagram"."oidc_payloads" SET consumed_at = now()
WHERE id = @id::text AND type = @type::text AND consumed_at IS NULL
RETURNING id;

-- name: DestroyOidcPayload :exec
DELETE FROM "exagram"."oidc_payloads" WHERE id = @id::text AND type = @type::text;

-- name: RevokeOidcPayloadsByGrantId :exec
DELETE FROM "exagram"."oidc_payloads" WHERE grant_id = @grant_id::text;

-- name: RevokeOidcGrant :exec
DELETE FROM "exagram"."oidc_payloads"
WHERE grant_id = @grant_id::text OR (type = 'Grant' AND id = @grant_id::text);
