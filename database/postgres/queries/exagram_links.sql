-- name: InsertLink :one
INSERT INTO "exagram"."links" (artifact_id, revision_id, token_hash, expires_at, max_views, created_by)
SELECT @artifact_id::uuid, @revision_id::uuid, @token_hash::text, @expires_at::timestamptz,
       sqlc.narg('max_views')::int, @created_by::uuid
WHERE "exagram".writer_in_workspace(
	@created_by::uuid, (SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = @artifact_id::uuid)
)
RETURNING id;

-- name: ListLinksByArtifact :many
SELECT id, artifact_id, revision_id, expires_at, max_views, views_used, revoked_at, created_by, created_at
FROM "exagram"."links"
WHERE artifact_id = @artifact_id::uuid
ORDER BY created_at DESC;

-- name: GetLinkById :one
SELECT id, artifact_id, revision_id, expires_at, max_views, views_used, revoked_at, created_by, created_at
FROM "exagram"."links"
WHERE id = @id::uuid;

-- name: GetLinkIdByTokenHash :one
SELECT id FROM "exagram"."links" WHERE token_hash = @token_hash::text;

-- name: RevokeLink :one
UPDATE "exagram"."links" SET revoked_at = now()
WHERE id = @id::uuid AND revoked_at IS NULL
RETURNING id;

-- name: ClaimLinkView :one
UPDATE "exagram"."links"
SET views_used = views_used + 1
WHERE id = @id::uuid
  AND revoked_at IS NULL
  AND expires_at > now()
  AND (max_views IS NULL OR views_used < max_views)
RETURNING id, artifact_id, revision_id, views_used, max_views;

-- name: RevokeExpiredLinks :many
UPDATE "exagram"."links" SET revoked_at = now()
WHERE revoked_at IS NULL AND expires_at <= now()
RETURNING id;

-- name: GetLinkTargetForLedger :one
SELECT l.artifact_id, l.revision_id FROM "exagram"."links" l WHERE l.id = @link_id::uuid;

-- name: IsLinkExhausted :one
SELECT EXISTS (
  SELECT 1 FROM "exagram"."links" l
  JOIN "exagram"."artifacts" a ON a.id = l.artifact_id
  WHERE l.id = @link_id::uuid
    AND l.revoked_at IS NULL
    AND l.expires_at > now()
    AND l.max_views IS NOT NULL
    AND l.views_used >= l.max_views
    AND a.deleted_at IS NULL
)::int AS exhausted;

-- name: GetLinkWatchableExpiry :one
-- Not through visible_artifacts: that drops a Link once its last view is claimed, and the page that
-- claimed it must still hear when the Link goes. A read only: no Ledger row, no view claimed.
SELECT l.expires_at
FROM "exagram"."links" l
JOIN "exagram"."artifacts" a ON a.id = l.artifact_id
WHERE l.id = @link_id::uuid
  AND l.revoked_at IS NULL
  AND l.expires_at > now()
  AND a.deleted_at IS NULL;
