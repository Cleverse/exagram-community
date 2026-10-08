-- name: GetRevisionForRedaction :one
SELECT r.id, r.artifact_id, r.storage_key, r.mime, r.sha256, r.extracted_text, r.extraction_status, a.kind,
       r.extraction_error, r.redaction_queued_at::text AS queued_token
FROM "exagram"."revisions" r
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
WHERE r.id = @revision_id;

-- name: StoreRedactedText :one
-- A result computed from input reset meanwhile is dropped; the newer queue entry redoes it.
UPDATE "exagram"."revisions"
SET redacted_text = @redacted_text::text,
    redaction_status = 'done',
    redaction_detector_version = @detector_version::int,
    redaction_input_sha256 = @input_sha256::text,
    redaction_error = NULL,
    redaction_attempts = 0,
    placeholder_types = @placeholder_types::text[]
WHERE id = @revision_id
  AND redaction_status = 'queued'
  AND redaction_queued_at::text IS NOT DISTINCT FROM sqlc.narg('queued_token')::text
RETURNING id;

-- name: MarkRedactionUnavailable :one
-- One statement for 'failed' and 'too_large': both mean Withheld, and both must clear the text so
-- no earlier, now-wrong Redacted Text can be served.
UPDATE "exagram"."revisions"
SET redacted_text = NULL,
    redaction_status = @redaction_status::text,
    redaction_detector_version = NULL,
    redaction_input_sha256 = NULL,
    redaction_error = sqlc.narg('redaction_error')::text,
    placeholder_types = '{}'
WHERE id = @revision_id
  AND redaction_status = 'queued'
  AND redaction_queued_at::text IS NOT DISTINCT FROM sqlc.narg('queued_token')::text
RETURNING id;

-- name: EnqueueRedactionForRevision :exec
-- The reset a write of a Revision body performs. Separate from the job's own bookkeeping so the
-- enqueue paths never invent their own column list.
UPDATE "exagram"."revisions"
SET redacted_text = NULL,
    redaction_status = 'queued',
    redaction_detector_version = NULL,
    redaction_input_sha256 = NULL,
    redaction_error = NULL,
    redaction_attempts = 0,
    redaction_queued_at = now(),
    placeholder_types = '{}'
WHERE id = @revision_id
  AND EXISTS (
    SELECT 1 FROM "exagram"."artifacts" a
    WHERE a.id = artifact_id AND a.kind <> 'image'
  );

-- name: ResetImageRedaction :exec
UPDATE "exagram"."revisions" r
SET redacted_text = NULL,
    redaction_status = 'none',
    redaction_detector_version = NULL,
    redaction_input_sha256 = NULL,
    redaction_error = NULL,
    redaction_attempts = 0,
    redaction_queued_at = NULL,
    placeholder_types = '{}'
FROM "exagram"."artifacts" a
WHERE r.id = @revision_id
  AND a.id = r.artifact_id
  AND a.kind = 'image'
  AND r.redaction_status = 'queued'
  AND r.redaction_queued_at::text IS NOT DISTINCT FROM sqlc.narg('queued_token')::text;

-- name: FailExhaustedRedactions :many
-- A worker that crashes on its last attempt leaves the row queued where no claim can reach it.
UPDATE "exagram"."revisions"
SET redaction_status = 'failed',
    redacted_text = NULL,
    redaction_detector_version = NULL,
    redaction_input_sha256 = NULL,
    placeholder_types = '{}',
    redaction_error = 'Redaction did not finish after the allowed attempts.'
WHERE redaction_status = 'queued'
  AND redaction_attempts >= @max_attempts::int
  AND (redaction_queued_at IS NULL OR redaction_queued_at < now() - make_interval(secs => @stale_seconds::int))
RETURNING id;

-- name: ClaimRevisionsForRedaction :many
-- The sweeper's one statement. SKIP LOCKED so two workers sweeping at once split the batch instead
-- of blocking. 'too_large' is never reclaimed: a bigger detector does not make the body smaller.
UPDATE "exagram"."revisions" r
SET redaction_status = 'queued',
    redaction_queued_at = now(),
    redaction_attempts = r.redaction_attempts + 1
FROM (
  SELECT candidate.id
  FROM "exagram"."revisions" candidate
  JOIN "exagram"."artifacts" a ON a.id = candidate.artifact_id
  WHERE a.kind <> 'image'
    AND candidate.redaction_attempts < @max_attempts::int
    AND (
      candidate.redaction_status IN ('none','failed')
      OR (
        candidate.redaction_status = 'queued'
        AND (candidate.redaction_queued_at IS NULL OR candidate.redaction_queued_at < now() - make_interval(secs => @stale_seconds::int))
      )
      OR (candidate.redaction_status = 'done' AND candidate.redaction_detector_version < @detector_version::int)
    )
  ORDER BY candidate.created_at
  LIMIT @row_limit::int
  FOR UPDATE OF candidate SKIP LOCKED
) picked
WHERE r.id = picked.id
RETURNING r.id;
