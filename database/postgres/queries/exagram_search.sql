-- name: OpenSearchCall :one
INSERT INTO "exagram"."ledger_calls" (principal_kind, principal_id, surface, action, status, workspace_id)
VALUES (@principal_kind, @principal_id, @surface, 'artifacts.search', 'authorized', sqlc.narg('workspace_id')::uuid)
RETURNING id;

-- name: DeliverSearchCall :exec
UPDATE "exagram"."ledger_calls"
SET status = 'delivered', delivered_at = now()
WHERE id = @call_id;

-- name: SearchVisibleArtifacts :many
WITH q AS (
    SELECT websearch_to_tsquery('simple', @query::text) AS tsq
),
hits AS (
    SELECT v.artifact_id,
           v.revision_id,
           v.access,
           a.title,
           a.kind,
           a.project_id,
           ts_rank(
               setweight(a.title_tsv, 'A') || setweight(coalesce(r.search_tsv, ''::tsvector), 'B'),
               q.tsq
           ) AS rank,
           ts_headline('simple', left(coalesce(r.extracted_text, ''), 900000), q.tsq,
                       'MaxFragments=1,MaxWords=32,MinWords=12,StartSel=<<,StopSel=>>') AS snippet
    FROM q
    CROSS JOIN "exagram".visible_artifacts(@principal_kind::text, @principal_id::uuid) v
    JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
    LEFT JOIN "exagram"."revisions" r ON r.id = v.revision_id
    WHERE (a.title_tsv @@ q.tsq OR r.search_tsv @@ q.tsq)
      AND a.workspace_id = @workspace_id::uuid
      AND (sqlc.narg('project_id')::uuid IS NULL OR a.project_id = sqlc.narg('project_id')::uuid)
    ORDER BY rank DESC, a.created_at DESC
    LIMIT @row_limit::int
),
served AS (
    INSERT INTO "exagram"."ledger_serves" (call_id, artifact_id, revision_id, outcome, reason)
    SELECT @call_id::uuid, h.artifact_id, h.revision_id, 'served', NULL FROM hits h
)
SELECT artifact_id, revision_id, access, title, kind, project_id, rank, snippet FROM hits;
