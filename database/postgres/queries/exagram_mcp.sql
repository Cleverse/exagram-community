-- Every row a Connection may see comes out of exagram.visible_artifacts or
-- exagram.connection_readable_revisions. Nothing here re-derives access, and nothing here selects
-- an artifact either function did not return.

-- name: McpListArtifacts :many
WITH matches AS (
    SELECT id, kind, title, project_id, revision_id, created_at
    FROM (
        SELECT a.id, a.kind, a.title, a.project_id, v.revision_id, a.created_at,
               r.redaction_status, r.redacted_text, r.redaction_detector_version,
               ("exagram".effective_redaction(a.id) AND @redaction_enabled::boolean) AS redaction_on
        FROM "exagram".visible_artifacts('connection', @connection_id::uuid) v
        JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
        JOIN "exagram"."revisions" r ON r.id = v.revision_id
        -- The boundary already drops a null revision for a connection; repeating it here means a
        -- change to that function can never quietly turn this list into a leak.
        WHERE v.revision_id IS NOT NULL
          AND (sqlc.narg('project_id')::uuid IS NULL OR a.project_id = sqlc.narg('project_id')::uuid)
          AND (sqlc.narg('kind')::text IS NULL OR a.kind = sqlc.narg('kind')::text)
    ) resolved
    WHERE (
        NOT redaction_on
        OR (
            redaction_status = 'done'
            AND redacted_text IS NOT NULL
            AND redacted_text <> ''
            AND redaction_detector_version >= @min_detector_version::int
        )
    )
    UNION ALL
    -- The pending-only exception: an Artifact with no Current Revision is invisible to
    -- visible_artifacts, but a Connection allowed to read one of its Pending Revisions may still list
    -- it, with no revision_id to resolve.
    SELECT a.id, a.kind, a.title, a.project_id, NULL::uuid AS revision_id, a.created_at
    FROM (
        SELECT DISTINCT cr.artifact_id
        FROM "exagram".connection_readable_revisions(@connection_id::uuid) cr
        JOIN "exagram"."revisions" r ON r.id = cr.revision_id
        JOIN "exagram"."artifacts" pa ON pa.id = cr.artifact_id
        WHERE cr.status = 'pending'
          AND (
              NOT ("exagram".effective_redaction(pa.id) AND @redaction_enabled::boolean)
              OR (
                  r.redaction_status = 'done'
                  AND r.redacted_text IS NOT NULL
                  AND r.redacted_text <> ''
                  AND r.redaction_detector_version >= @min_detector_version::int
              )
          )
    ) pr
    JOIN "exagram"."artifacts" a ON a.id = pr.artifact_id
    WHERE NOT EXISTS (
        SELECT 1 FROM "exagram".visible_artifacts('connection', @connection_id::uuid) v
        WHERE v.artifact_id = a.id
      )
      AND (sqlc.narg('project_id')::uuid IS NULL OR a.project_id = sqlc.narg('project_id')::uuid)
      AND (sqlc.narg('kind')::text IS NULL OR a.kind = sqlc.narg('kind')::text)
)
SELECT id, kind, title, project_id, revision_id
FROM matches
ORDER BY created_at DESC
LIMIT @row_limit::int;

-- name: McpSearchArtifacts :many
-- Reads the generated search columns and their GIN index. It writes no ledger rows: the MCP
-- usecase wrapper owns the call, so one MCP call still holds exactly one `ledger_calls` row.
WITH q AS (
    SELECT websearch_to_tsquery('simple', @q::text) AS tsq
), pending AS (
    SELECT DISTINCT cr.artifact_id
    FROM "exagram".connection_readable_revisions(@connection_id::uuid) cr
    JOIN "exagram"."revisions" r ON r.id = cr.revision_id
    JOIN "exagram"."artifacts" pa ON pa.id = cr.artifact_id
    WHERE cr.status = 'pending'
      AND (
          NOT ("exagram".effective_redaction(pa.id) AND @redaction_enabled::boolean)
          OR (
              r.redaction_status = 'done'
              AND r.redacted_text IS NOT NULL
              AND r.redacted_text <> ''
              AND r.redaction_detector_version >= @min_detector_version::int
          )
      )
), candidates AS (
    SELECT a.id, a.kind, a.title, a.project_id, a.title_tsv, a.created_at, v.revision_id,
           r.search_tsv, r.redacted_tsv, r.extracted_text, r.redacted_text,
           r.redaction_status, r.redaction_detector_version,
           ("exagram".effective_redaction(a.id) AND @redaction_enabled::boolean) AS redaction_on
    FROM "exagram".visible_artifacts('connection', @connection_id::uuid) v
    JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
    JOIN "exagram"."revisions" r ON r.id = v.revision_id
    WHERE v.revision_id IS NOT NULL
      AND (sqlc.narg('project_id')::uuid IS NULL OR a.project_id = sqlc.narg('project_id')::uuid)
), matches AS (
    SELECT id, kind, title, project_id, revision_id,
           ts_rank(
               setweight(title_tsv, 'A') || setweight(
                   coalesce(CASE WHEN redaction_on THEN redacted_tsv ELSE search_tsv END, ''::tsvector),
                   'B'
               ),
               q.tsq
           ) AS rank,
           ts_headline(
               'simple',
               left(coalesce(CASE WHEN redaction_on THEN redacted_text ELSE extracted_text END, ''), 900000),
               q.tsq,
               'MaxFragments=1,MaxWords=32,MinWords=12,StartSel=<<,StopSel=>>'
           ) AS snippet,
           created_at,
           redaction_on,
           redaction_detector_version
    FROM candidates
    CROSS JOIN q
    WHERE (
        NOT redaction_on
        OR (
            redaction_status = 'done'
            AND redacted_text IS NOT NULL
            AND redacted_text <> ''
            AND redaction_detector_version >= @min_detector_version::int
        )
    )
      AND (
        title_tsv @@ q.tsq
        OR CASE WHEN redaction_on THEN redacted_tsv ELSE search_tsv END @@ q.tsq
      )
    UNION ALL
    -- Same pending-only exception as McpListArtifacts: title-only match, no snippet, no revision to
    -- rank.
    SELECT a.id, a.kind, a.title, a.project_id, NULL::uuid AS revision_id, 0::real AS rank,
           ''::text AS snippet, a.created_at, NULL::boolean AS redaction_on,
           NULL::int AS redaction_detector_version
    FROM q, pending pr
    JOIN "exagram"."artifacts" a ON a.id = pr.artifact_id
    WHERE NOT EXISTS (
        SELECT 1 FROM "exagram".visible_artifacts('connection', @connection_id::uuid) v
        WHERE v.artifact_id = a.id
      )
      AND a.title_tsv @@ q.tsq
      AND (sqlc.narg('project_id')::uuid IS NULL OR a.project_id = sqlc.narg('project_id')::uuid)
)
SELECT id, kind, title, project_id, revision_id, rank, snippet, redaction_on, redaction_detector_version
FROM matches
ORDER BY rank DESC, created_at DESC
LIMIT @row_limit::int;

-- name: McpGetArtifactForRead :one
-- selector 'current' is the Revision the boundary resolves by default; 'latest' and 'seq' may go
-- past it, and only as far as connection_readable_revisions allows.
WITH resolved AS (
    SELECT a.id, a.kind, a.title, cr.revision_id, cr.seq, cr.status,
           r.storage_key, r.mime, r.extracted_text,
           r.redacted_text, r.redaction_status, r.redaction_detector_version,
           ("exagram".effective_redaction(a.id) AND @redaction_enabled::boolean) AS redaction_on, r.sha256, r.bytes
    FROM "exagram".connection_readable_revisions(@connection_id::uuid) cr
    JOIN "exagram"."artifacts" a ON a.id = cr.artifact_id
    JOIN "exagram"."revisions" r ON r.id = cr.revision_id
    WHERE cr.artifact_id = @artifact_id::uuid
      AND CASE @selector::text
            WHEN 'current' THEN cr.is_default
            WHEN 'latest' THEN true
            WHEN 'seq' THEN cr.seq = sqlc.narg('seq')::int
            ELSE false
          END
    ORDER BY cr.seq DESC
    LIMIT 1
), gated AS (
    SELECT id, kind, title, revision_id, seq, status, storage_key, mime, extracted_text,
           redacted_text, redaction_detector_version, redaction_on, sha256, bytes,
           (
               NOT redaction_on
               OR (
                   redaction_status = 'done'
                   AND redacted_text IS NOT NULL
                   AND redacted_text <> ''
                   AND redaction_detector_version >= @min_detector_version::int
               )
           ) AS ready
    FROM resolved
)
SELECT id, kind, title, revision_id, seq, status,
       CASE WHEN NOT redaction_on AND ready THEN storage_key END AS storage_key,
       mime,
       CASE WHEN NOT redaction_on AND ready THEN extracted_text END AS extracted_text,
       redaction_on,
       CASE WHEN redaction_on AND ready THEN redacted_text END AS redacted_text,
       redaction_detector_version,
       ready,
       CASE WHEN NOT redaction_on AND ready THEN sha256 END AS sha256,
       CASE WHEN NOT redaction_on AND ready THEN bytes END AS bytes
FROM gated;

-- name: McpListProjects :many
-- The Projects this Connection's person owns or holds a Grant on, with the access held in each
-- (a Project Grant reaches its one level of children too). artifact_upload needs owner, edit or collaborate (a new Artifact needs owner or edit).
WITH c AS (
    SELECT id, user_id FROM "exagram"."connections" WHERE id = @connection_id::uuid AND revoked_at IS NULL
), visible AS (
	SELECT p.id, p.parent_project_id,
	       "exagram".user_project_role(c.user_id, p.id) AS person_access,
	       "exagram".connection_project_right(c.id, p.id) AS folder_right
	FROM c
	JOIN "exagram"."projects" p ON "exagram".connection_project_right(c.id, p.id) IS NOT NULL
)
SELECT v.id, p.name,
       CASE WHEN parent.id IS NOT NULL THEN v.parent_project_id ELSE NULL END AS parent_project_id,
	   CASE WHEN v.folder_right = 'view' THEN 'view' ELSE v.person_access END AS access
FROM visible v
JOIN "exagram"."projects" p ON p.id = v.id
LEFT JOIN visible parent ON parent.id = v.parent_project_id
ORDER BY coalesce(parent.id::text, v.id::text), parent.id NULLS FIRST, p.name;

-- name: McpLockWriterMemberships :many
SELECT p.owner_id FROM "exagram"."connections" c
JOIN "exagram"."projects" p ON p.id = @project_id::uuid
JOIN "exagram"."memberships" m ON m.workspace_id = p.workspace_id AND m.user_id IN (p.owner_id, c.user_id)
WHERE c.id = @connection_id::uuid
ORDER BY m.user_id
FOR SHARE OF m;

-- name: McpInsertArtifact :one
-- Owner is the Project's owner, which is who approves. The join is the person's reach:
-- a Project they cannot edit, or one handed to another Owner since the lock, yields no row, and the caller refuses.
-- A reserved id (artifact_upload_url's pending upload) becomes the Artifact's id; without one the database picks it.
INSERT INTO "exagram"."artifacts" (id, workspace_id, owner_id, project_id, kind, title)
SELECT coalesce(sqlc.narg('id')::uuid, gen_random_uuid()), p.workspace_id, p.owner_id, p.id, @kind::text, @title::text
FROM "exagram"."connections" c
JOIN "exagram"."projects" p ON p.id = @project_id::uuid
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL
  AND p.owner_id = @locked_owner_id::uuid
  AND "exagram".writer_in_workspace(p.owner_id, p.workspace_id)
  AND "exagram".writer_in_workspace(c.user_id, p.workspace_id)
  AND "exagram".connection_project_right(c.id, p.id) = 'edit'
  AND "exagram".user_project_role(c.user_id, p.id) IN ('owner', 'edit')
RETURNING id;

-- name: McpFindWritableArtifact :one
-- reach_rows, not visible_artifacts: a pending-only Artifact has no Current Revision to resolve,
-- so the boundary hides it from visible_artifacts even from the Connection that may add to it.
-- Only the row visible_artifacts would pick decides, so a Viewer grant that outranks a project
-- edit grant still refuses, exactly as the web upload path does.
SELECT a.id, a.kind
FROM "exagram"."artifacts" a
JOIN "exagram"."connections" c ON c.id = @connection_id::uuid AND c.revoked_at IS NULL
WHERE a.id = @artifact_id::uuid
  AND "exagram".connection_can_write_artifact(c.id, a.id)
  AND "exagram".connection_artifact_right(c.id, a.id) = 'edit';

-- name: McpInsertRevision :one
INSERT INTO "exagram"."revisions"
  (artifact_id, seq, status, author_user_id, author_connection_id, storage_key, mime, bytes, sha256, note, extraction_status)
SELECT @artifact_id::uuid,
       coalesce((SELECT max(seq) FROM "exagram"."revisions" WHERE artifact_id = @artifact_id::uuid), 0) + 1,
       'pending', c.user_id, c.id, @storage_key::text, @mime::text, @bytes::int, @sha256::text,
       sqlc.narg('note')::text, 'none'
FROM "exagram"."connections" c
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL
  AND "exagram".connection_can_write_artifact(c.id, @artifact_id::uuid)
  AND "exagram".connection_artifact_right(c.id, @artifact_id::uuid) = 'edit'
RETURNING id, seq;

-- name: McpFindOwnUploadedRevision :one
-- artifact_upload_complete's idempotency: only a Revision this Connection wrote is ever named back
-- to it, and the earliest one, since a Restore later reuses the same storage key.
SELECT r.id, r.seq, r.status, r.extraction_status
FROM "exagram"."revisions" r
JOIN "exagram"."connections" c ON c.id = @connection_id::uuid AND c.revoked_at IS NULL
WHERE r.artifact_id = @artifact_id::uuid
  AND r.storage_key = @storage_key::text
  AND r.author_connection_id = c.id
ORDER BY r.seq ASC
LIMIT 1;

-- name: McpUploadKeyClaimed :one
SELECT EXISTS (
    SELECT 1 FROM "exagram"."revisions"
    WHERE artifact_id = @artifact_id::uuid AND storage_key = @storage_key::text
) AS claimed;

-- name: McpInsertUploadedRevision :one
-- McpInsertRevision's gate, for a body the Connection PUT itself: extraction is decided by kind
-- at finalize, as the web path does.
INSERT INTO "exagram"."revisions"
  (artifact_id, seq, status, author_user_id, author_connection_id, storage_key, mime, bytes, sha256, note,
   extracted_text, extraction_status)
SELECT @artifact_id::uuid,
       coalesce((SELECT max(seq) FROM "exagram"."revisions" WHERE artifact_id = @artifact_id::uuid), 0) + 1,
       'pending', c.user_id, c.id, @storage_key::text, @mime::text, @bytes::int, @sha256::text,
       sqlc.narg('note')::text, sqlc.narg('extracted_text')::text, @extraction_status::text
FROM "exagram"."connections" c
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL
  AND "exagram".connection_can_write_artifact(c.id, @artifact_id::uuid)
  AND "exagram".connection_artifact_right(c.id, @artifact_id::uuid) = 'edit'
RETURNING id, seq, status, extraction_status;

-- name: McpPublishOnUpload :one
-- The Connection's person is the author publish_on_upload checks. Only the Connection that wrote
-- the Revision gets a row, and a revoked one gets none, so either way it stays Pending.
SELECT "exagram"."publish_on_upload"(r.id, c.user_id) AS published_revision_id
FROM "exagram"."connections" c
JOIN "exagram"."revisions" r ON r.id = @revision_id::uuid AND r.author_connection_id = c.id
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL
  AND (NOT @has_placeholders::boolean OR "exagram".is_personal(a.workspace_id));

-- name: McpDeleteUnrevisedArtifact :exec
DELETE FROM "exagram"."artifacts"
WHERE id = @id::uuid
  AND NOT EXISTS (SELECT 1 FROM "exagram"."revisions" WHERE artifact_id = @id::uuid);

-- name: McpDeleteStalePendingUploads :exec
-- 48 hours outlives the longest ticket (24 h) plus completion.
DELETE FROM "exagram"."mcp_pending_uploads" WHERE created_at < now() - interval '48 hours';

-- name: McpInsertPendingUpload :one
-- McpInsertArtifact's reach, checked when the URL is issued; complete checks it again. Nothing is written to
-- artifacts until the upload completes.
INSERT INTO "exagram"."mcp_pending_uploads" (storage_key, artifact_id, connection_id, project_id, kind, title, mime, bytes)
SELECT @storage_key::text, @artifact_id::uuid, c.id, p.id, @kind::text, @title::text, @mime::text, @bytes::int
FROM "exagram"."connections" c
JOIN "exagram"."projects" p ON p.id = @project_id::uuid
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL
  AND "exagram".writer_in_workspace(p.owner_id, p.workspace_id)
  AND "exagram".writer_in_workspace(c.user_id, p.workspace_id)
  AND "exagram".connection_project_right(c.id, p.id) = 'edit'
  AND "exagram".user_project_role(c.user_id, p.id) IN ('owner', 'edit')
RETURNING artifact_id;

-- name: McpFindPendingUpload :one
-- Only the Connection that was handed the URL finds the row; anyone else's lookup reads as no row.
SELECT project_id, kind, title, mime, bytes
FROM "exagram"."mcp_pending_uploads"
WHERE connection_id = @connection_id::uuid
  AND artifact_id = @artifact_id::uuid
  AND storage_key = @storage_key::text;

-- name: McpDeletePendingUpload :exec
DELETE FROM "exagram"."mcp_pending_uploads" WHERE storage_key = @storage_key::text;

-- name: McpRemoveGrant :one
-- manage belongs to the Owner, and the Owner is exagram.artifact_owner, not the
-- Artifact's own owner_id, so the Project Owner manages a Grant on an Artifact somebody else
-- authored inside it.
DELETE FROM "exagram"."grants" g
USING "exagram"."artifacts" a, "exagram"."connections" c
WHERE g.id = @grant_id::uuid
  AND g.artifact_id = a.id
  AND c.id = @connection_id::uuid AND c.revoked_at IS NULL
  AND a.deleted_at IS NULL
  AND "exagram".artifact_owner(a.id) = c.user_id
  AND "exagram".connection_artifact_right(c.id, a.id) = 'edit'
RETURNING g.id, g.artifact_id;

-- name: McpUpdateGrantRole :one
UPDATE "exagram"."grants" g
SET role = @role::text
FROM "exagram"."artifacts" a, "exagram"."connections" c
WHERE g.id = @grant_id::uuid
  AND g.artifact_id = a.id
  AND NOT (@role::text = 'collaborate' AND "exagram".is_personal(a.workspace_id))
  AND c.id = @connection_id::uuid AND c.revoked_at IS NULL
  AND a.deleted_at IS NULL
  AND "exagram".artifact_owner(a.id) = c.user_id
  AND "exagram".connection_artifact_right(c.id, a.id) = 'edit'
RETURNING g.id, g.artifact_id, g.role;

-- name: McpReadRefusalReason :one
SELECT CASE
    WHEN c.folder_access = 'named'
     AND "exagram".connection_covers_workspace(c.id, art.workspace_id)
     AND "exagram".connection_artifact_right(c.id, @artifact_id::uuid) IS NULL
     AND (
       "exagram".person_readable_artifact(c.user_id, @artifact_id::uuid)
       OR (
         "exagram".reaches_artifact(c.user_id, @artifact_id::uuid)
         AND EXISTS (
           SELECT 1 FROM "exagram"."revisions" r
           WHERE r.artifact_id = @artifact_id::uuid
             AND r.status = 'pending' AND r.author_connection_id = c.id
         )
       )
     )
        THEN 'outside-connection-folders'
    ELSE 'out-of-boundary'
END AS reason
FROM "exagram"."connections" c
LEFT JOIN "exagram"."artifacts" art ON art.id = @artifact_id::uuid
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL;

-- name: McpNewArtifactRefusalReason :one
SELECT CASE
    WHEN c.folder_access = 'named'
     AND "exagram".connection_covers_workspace(c.id, p.workspace_id)
     AND "exagram".connection_project_right(c.id, @project_id::uuid) IS DISTINCT FROM 'edit'
     AND "exagram".user_project_role(c.user_id, @project_id::uuid) IN ('owner', 'edit')
        THEN 'outside-connection-folders'
    ELSE 'out-of-boundary'
END AS reason
FROM "exagram"."connections" c
LEFT JOIN "exagram"."projects" p ON p.id = @project_id::uuid
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL;

-- name: McpRevisionRefusalReason :one
SELECT CASE
    WHEN c.folder_access = 'named'
     AND "exagram".connection_artifact_right(c.id, @artifact_id::uuid) IS DISTINCT FROM 'edit'
     AND "exagram".connection_can_write_artifact(c.id, @artifact_id::uuid)
        THEN 'outside-connection-folders'
    ELSE 'out-of-boundary'
END AS reason
FROM "exagram"."connections" c
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL;

-- name: McpGrantRefusalReason :one
SELECT CASE
    WHEN c.folder_access = 'named'
     AND a.id IS NOT NULL
     AND "exagram".connection_covers_workspace(c.id, a.workspace_id)
     AND "exagram".connection_artifact_right(c.id, g.artifact_id) IS DISTINCT FROM 'edit'
     AND "exagram".artifact_owner(g.artifact_id) = c.user_id
        THEN 'outside-connection-folders'
    ELSE 'out-of-boundary'
END AS reason
FROM "exagram"."connections" c
LEFT JOIN "exagram"."grants" g ON g.id = @grant_id::uuid
LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id AND a.deleted_at IS NULL
WHERE c.id = @connection_id::uuid AND c.revoked_at IS NULL;
