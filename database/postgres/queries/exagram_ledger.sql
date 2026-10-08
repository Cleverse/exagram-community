-- name: InsertLedgerCall :one
INSERT INTO "exagram"."ledger_calls" (principal_kind, principal_id, surface, action, subject, workspace_id)
VALUES (@principal_kind, @principal_id, @surface, @action, sqlc.narg('subject'), sqlc.narg('workspace_id')::uuid)
RETURNING *;

-- name: InsertLedgerServe :one
INSERT INTO "exagram"."ledger_serves" (call_id, artifact_id, revision_id, outcome, reason, form, detector_version)
VALUES (@call_id, sqlc.narg('artifact_id'), sqlc.narg('revision_id'), @outcome, sqlc.narg('reason'),
	sqlc.narg('form'), sqlc.narg('detector_version'))
RETURNING *;

-- name: MarkLedgerCallDelivered :exec
-- coalesce: a digest already stamped by SetLedgerCallBodySha inside the same serve must survive
-- this settle, which always passes null unless its own caller has a digest at hand.
UPDATE "exagram"."ledger_calls"
SET status = 'delivered', delivered_at = now(), body_sha256 = coalesce(sqlc.narg('body_sha256'), body_sha256)
WHERE id = @id;

-- name: MarkLedgerCallFailed :exec
UPDATE "exagram"."ledger_calls"
SET status = 'failed', delivered_at = now()
WHERE id = @id;

-- name: SetLedgerCallBodySha :exec
UPDATE "exagram"."ledger_calls" SET body_sha256 = @body_sha256::text WHERE id = @call_id::uuid;
