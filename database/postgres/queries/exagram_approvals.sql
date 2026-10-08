-- database/postgres/queries/exagram_approvals.sql
-- Pending revisions reach a reader only through exagram.pending_revisions(p_user_id), which exposes a
-- revision_id column; every other field is joined from the tables here.

-- name: ListPendingRevisionDetails :many
SELECT
  p.revision_id,
  r.artifact_id,
  r.seq,
  r.author_user_id,
  r.author_connection_id,
  r.mime,
  r.bytes,
  r.note,
  r.placeholder_types,
  r.redaction_status,
  r.created_at,
  a.title,
  a.kind,
  a.owner_id,
  -- Whether the reader approves it (exagram.artifact_owner: the folder's owner, else the Artifact's). An
  -- Author sees their own pending Revisions here too, with false; clients never re-derive this from owner_id.
  p.is_approver,
  -- Who wrote it, for the Approver's list: the person, and the Connection when one wrote on their behalf.
  u.name AS author_name,
  c.name AS author_connection_name
FROM "exagram"."pending_revisions"(@user_id) p
JOIN "exagram"."revisions" r ON r.id = p.revision_id
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
JOIN "exagram"."users" u ON u.id = r.author_user_id
LEFT JOIN "exagram"."connections" c ON c.id = r.author_connection_id
WHERE a.workspace_id = @workspace_id::uuid
ORDER BY r.created_at ASC;

-- name: ApproveRevision :one
SELECT "exagram"."approve_revision"(@revision_id, @approver_user_id, @confirm_placeholders::boolean)
  AS approved_revision_id;

-- name: DiscardRevision :one
UPDATE "exagram"."revisions" r
SET status = 'discarded', discarded_at = now()
FROM "exagram"."artifacts" a
WHERE r.id = @revision_id
  AND a.id = r.artifact_id
  AND "exagram".artifact_owner(a.id) = @approver_user_id
  AND a.deleted_at IS NULL
  AND r.status = 'pending'
RETURNING r.id;
