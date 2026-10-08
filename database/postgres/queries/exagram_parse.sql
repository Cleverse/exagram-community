-- name: GetRevisionForParse :one
SELECT r.id, r.storage_key, r.mime, r.sha256, r.extraction_status, a.kind
FROM "exagram"."revisions" r
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
WHERE r.id = @revision_id;

-- name: MarkExtractionDone :exec
-- Extraction changes the exact string a Connection is served, so the Redacted Text made from the
-- old input is void from this statement on, not from whenever the redact job next runs.
UPDATE "exagram"."revisions"
SET extracted_text = @extracted_text,
    extraction_status = 'done',
    extraction_error = NULL,
    redacted_text = NULL,
    redaction_status = 'queued',
    redaction_detector_version = NULL,
    redaction_input_sha256 = NULL,
    redaction_error = NULL,
    redaction_attempts = 0,
    redaction_queued_at = now(),
    placeholder_types = '{}'
WHERE id = @revision_id;

-- name: MarkExtractionFailed :exec
UPDATE "exagram"."revisions"
SET extraction_status = 'failed',
    extraction_error = @extraction_error
WHERE id = @revision_id;
