-- name: ListCommentsByRevision :many
SELECT c.id,
       CASE WHEN c.source_artifact_id IS NOT NULL THEN @revision_id::uuid ELSE c.revision_id END AS revision_id,
       c.author_id, c.body, c.created_at, u.name AS author_name
FROM "exagram"."comments" c
JOIN "exagram"."users" u ON u.id = c.author_id
WHERE c.revision_id = @revision_id::uuid
   OR c.source_artifact_id = (
       SELECT artifact_id FROM "exagram"."revisions" WHERE id = @revision_id::uuid
   )
ORDER BY c.created_at ASC;

-- name: InsertComment :one
INSERT INTO "exagram"."comments" (revision_id, author_id, body)
VALUES (@revision_id::uuid, @author_id::uuid, @body::text)
RETURNING id;

-- name: GetCommentById :one
SELECT c.id, c.revision_id, c.author_id, c.body, c.created_at, u.name AS author_name
FROM "exagram"."comments" c
JOIN "exagram"."users" u ON u.id = c.author_id
WHERE c.id = @id::uuid;

-- name: GetRevisionArtifact :one
SELECT r.id, r.artifact_id FROM "exagram"."revisions" r WHERE r.id = @revision_id::uuid;
