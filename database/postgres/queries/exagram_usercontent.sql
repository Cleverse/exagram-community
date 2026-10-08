-- name: GetRevisionBodyRef :one
SELECT r.id, r.artifact_id, r.storage_key, r.mime, r.sha256, r.extracted_text, a.kind, a.title,
       a.filename
FROM "exagram"."revisions" r
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
WHERE r.id = @revision_id::uuid;

-- name: InsertUsercontentServe :exec
-- A body fetched through a Link-minted token is a served read of that Link's call, not a second
-- call: the token carries the call id, so the row lands under the page view that framed it.
INSERT INTO "exagram"."ledger_serves" (call_id, artifact_id, revision_id, outcome, reason)
VALUES (@call_id::uuid, @artifact_id::uuid, @revision_id::uuid, 'served', NULL);
