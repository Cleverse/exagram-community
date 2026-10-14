-- name: LockArtifactRevisions :exec
SELECT pg_advisory_xact_lock(hashtext('exagram:artifact:' || @artifact_id::text));

-- name: LockStorageKey :exec
SELECT pg_advisory_xact_lock(hashtext('exagram:storage-key:' || @storage_key::text));

-- name: NextRevisionSeq :one
SELECT (coalesce(max(seq), 0) + 1)::int AS next_seq
FROM "exagram"."revisions" WHERE artifact_id = @artifact_id;

-- name: InsertRevision :one
INSERT INTO "exagram"."revisions" (
  artifact_id, seq, author_user_id, author_connection_id, storage_key, mime, bytes, sha256, note, extracted_text,
  extraction_status
) VALUES (
  @artifact_id, @seq, @author_user_id, sqlc.narg('author_connection_id'), @storage_key, @mime, @bytes, @sha256,
  sqlc.narg('note'), sqlc.narg('extracted_text'), @extraction_status
)
RETURNING *;

-- name: ListRevisionsByArtifact :many
SELECT r.id, r.artifact_id, r.seq, r.status, r.author_user_id, r.author_connection_id,
       r.storage_key, r.mime, r.bytes, r.sha256, r.note, r.extracted_text,
       r.extraction_status, r.created_at, r.approved_at, r.extraction_error, r.search_tsv,
       r.redacted_text, r.redaction_status, r.redaction_detector_version,
       r.redaction_input_sha256, r.redaction_error, r.redaction_attempts,
       r.redaction_queued_at, r.placeholder_types, r.redacted_tsv,
       r.source_parent_revision_id, r.source_restored_from, r.source_snippet, r.source_origin,
       r.source_client_id, r.source_storage_path,
       ai.revision_id AS source_ai_revision_id, ai.model AS source_ai_model,
       ai.instruction AS source_ai_instruction, ai.scoped AS source_ai_scoped,
       ai.created_at AS source_ai_created_at
FROM "exagram"."revisions" r
LEFT JOIN "exagram"."revision_ai_metadata" ai ON ai.revision_id = r.id
WHERE r.artifact_id = @artifact_id ORDER BY r.seq DESC;

-- name: GetRevisionById :one
SELECT * FROM "exagram"."revisions" WHERE id = @id;

-- name: GetRevisionInArtifact :one
SELECT * FROM "exagram"."revisions" WHERE id = @id AND artifact_id = @artifact_id;

-- name: StorageKeysInUse :many
-- One pass over revisions for the whole batch; storage_key has no index of its own.
SELECT DISTINCT r.storage_key FROM "exagram"."revisions" r WHERE r.storage_key = ANY (@storage_keys::text[]);

-- name: GetRevisionByStorageKey :one
SELECT * FROM "exagram"."revisions" WHERE artifact_id = @artifact_id AND storage_key = @storage_key;

-- name: PublishOnUpload :one
SELECT "exagram"."publish_on_upload"(@revision_id::uuid, @author_user_id::uuid) AS published_revision_id;

-- name: PublishInPersonal :one
SELECT "exagram"."publish_on_upload"(r.id, @author_user_id::uuid) AS published_revision_id
FROM "exagram"."revisions" r
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
WHERE r.id = @revision_id::uuid AND "exagram".is_personal(a.workspace_id);
