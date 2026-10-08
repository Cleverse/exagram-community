-- Unauthenticated link previews (ADR 0019). A row comes back only when the preview may show
-- metadata; a hidden, deleted or unknown target returns nothing, and the caller renders the one
-- generic page for all three. Title, kind and workspace name only: never a body.

-- name: GetArtifactUnfurl :one
-- An Artifact open to Anyone with the link that needs a password, or whose address has expired, unfurls as the
-- generic page: its title would otherwise reach whoever holds the address without the password (ADR 0044). The
-- caller draws the same page for a gated, hidden, deleted or unknown one, so the card tells none of them apart.
SELECT a.title, a.kind, w.name AS workspace_name
FROM "exagram"."artifacts" a
JOIN "exagram"."workspaces" w ON w.id = a.workspace_id
LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
WHERE a.id = @id
  AND a.deleted_at IS NULL
  AND w.link_preview = 'metadata'
  AND COALESCE(p.link_preview, 'metadata') = 'metadata'
  AND NOT (a.general_access = 'anyone'
    AND (a.anyone_password_on OR (a.anyone_expires_at IS NOT NULL AND a.anyone_expires_at <= now())));

-- name: GetProjectUnfurl :one
SELECT p.name, w.name AS workspace_name
FROM "exagram"."projects" p
JOIN "exagram"."workspaces" w ON w.id = p.workspace_id
WHERE p.id = @id
  AND w.link_preview = 'metadata'
  AND p.link_preview = 'metadata';
