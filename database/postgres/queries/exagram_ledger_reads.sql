-- name: ListLedgerForArtifact :many
-- Both Ledger lists are one row per serve and page on the serve row, not the call: a list or search
-- call writes many rows, and a page boundary inside it must not drop the rest. The cursor carries
-- started_at as microsecond UTC text, since a JS Date would truncate it to milliseconds.
SELECT c.id AS call_id, c.principal_kind, c.principal_id, c.surface, c.action, c.status,
       c.started_at, c.delivered_at, s.artifact_id, s.revision_id, s.outcome, s.reason,
       s.id AS serve_id,
       to_char(c.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS cursor_started_at
FROM "exagram"."ledger_serves" s
JOIN "exagram"."ledger_calls" c ON c.id = s.call_id
WHERE s.artifact_id = @artifact_id::uuid
  AND (sqlc.narg('cursor_started_at')::text IS NULL
       OR (c.started_at, c.id, s.id) < (CAST(sqlc.narg('cursor_started_at')::text AS timestamptz),
                                        sqlc.narg('cursor_call_id')::uuid, sqlc.narg('cursor_serve_id')::uuid))
ORDER BY c.started_at DESC, c.id DESC, s.id DESC
LIMIT @row_limit::int;

-- name: ListLedgerActivity :many
SELECT c.id AS call_id, c.principal_kind, c.principal_id, c.surface, c.action, c.status,
       c.started_at, c.delivered_at, s.artifact_id, s.revision_id, s.outcome, s.reason,
       s.id AS serve_id,
       to_char(c.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')::text AS cursor_started_at,
       COALESCE(pu.id, cu.id) AS actor_user_id,
       COALESCE(pu.name, cu.name) AS actor_name,
       COALESCE(pu.email, cu.email)::text AS actor_email,
       c.subject
FROM "exagram"."ledger_serves" s
JOIN "exagram"."ledger_calls" c ON c.id = s.call_id
LEFT JOIN "exagram"."users" pu ON c.principal_kind = 'user' AND pu.id = c.principal_id
LEFT JOIN "exagram"."connections" pc ON c.principal_kind = 'connection' AND pc.id = c.principal_id
LEFT JOIN "exagram"."users" cu ON cu.id = pc.user_id
LEFT JOIN "exagram"."artifacts" sa ON sa.id = s.artifact_id
LEFT JOIN "exagram"."workspaces" sw ON sw.id = sa.workspace_id
WHERE ((c.workspace_id = @workspace_id::uuid AND (sw.id IS NULL OR sw.kind = 'team' OR s.outcome = 'withheld'))
       OR sa.workspace_id = @workspace_id::uuid)
  AND (sqlc.narg('cursor_started_at')::text IS NULL
       OR (c.started_at, c.id, s.id) < (CAST(sqlc.narg('cursor_started_at')::text AS timestamptz),
                                        sqlc.narg('cursor_call_id')::uuid, sqlc.narg('cursor_serve_id')::uuid))
ORDER BY c.started_at DESC, c.id DESC, s.id DESC
LIMIT @row_limit::int;

-- name: ListArtifactViewers :many
-- Who has opened an Artifact: every person served a body read of it (the Owner aside), with their
-- first and last open and how many times. Listing an Artifact in a library is not opening it.
SELECT u.id AS user_id, u.name, u.email::text AS email,
       min(c.started_at)::timestamptz AS first_opened_at,
       max(c.started_at)::timestamptz AS last_opened_at,
       count(*)::int AS open_count
FROM "exagram"."ledger_serves" s
JOIN "exagram"."ledger_calls" c ON c.id = s.call_id
JOIN "exagram"."users" u ON c.principal_kind = 'user' AND u.id = c.principal_id
WHERE s.artifact_id = @artifact_id::uuid
  AND s.outcome = 'served'
  AND c.action IN ('artifacts.get', 'revisions.text', 'revisions.bodyToken')
  AND u.id IS DISTINCT FROM "exagram".artifact_owner(@artifact_id::uuid)
GROUP BY u.id, u.name, u.email
ORDER BY max(c.started_at) DESC;
