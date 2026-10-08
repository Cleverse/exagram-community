-- name: InsertProject :one
INSERT INTO "exagram"."projects" (workspace_id, owner_id, parent_project_id, name, link_preview)
SELECT @workspace_id::uuid, @owner_id::uuid, sqlc.narg('parent_project_id')::uuid, @name::text,
       (SELECT w.link_preview FROM "exagram"."workspaces" w WHERE w.id = @workspace_id::uuid)
WHERE "exagram".writer_in_workspace(@owner_id::uuid, @workspace_id::uuid)
RETURNING *;

-- name: ListProjectsByOwner :many
SELECT id, workspace_id, owner_id, parent_project_id, name, created_at, redaction, publish_policy, link_preview,
       description AS source_description
FROM "exagram"."projects"
WHERE owner_id = @owner_id
ORDER BY coalesce(parent_project_id::text, id::text), parent_project_id NULLS FIRST, name;

-- The Projects a user reaches: their own, and any with a Grant on it or its parent (which reaches every child).
-- member_names is everyone but the Owner who reaches it, one entry per person. Like `grants.list`, only someone
-- who may invite (the Owner, an Editor, a Collaborator) reads it; a Viewer gets NULL.
-- name: ListVisibleProjects :many
SELECT p.id, p.workspace_id, p.owner_id, p.parent_project_id, p.name, p.created_at, p.redaction, p.publish_policy,
       p.link_preview, p.description AS source_description,
       owner.name AS owner_name,
       (CASE
          WHEN "exagram".live_member(@user_id, p.workspace_id)
           AND (p.owner_id = @user_id
            OR EXISTS (SELECT 1
                         FROM "exagram"."grants" mine
                        WHERE mine.grantee_id = @user_id
                          AND mine.project_id IN (p.id, p.parent_project_id)
                          AND mine.role IN ('edit', 'collaborate')))
          THEN coalesce((SELECT array_agg(m.name ORDER BY m.name)
                           FROM (SELECT DISTINCT u.id,
                                        CASE WHEN "exagram".grantee_pending(u.id, p.workspace_id)
                                             THEN lower(u.email::text) ELSE u.name END AS name
                                   FROM "exagram"."grants" g
                                   JOIN "exagram"."users" u ON u.id = g.grantee_id
                                  WHERE g.project_id IN (p.id, p.parent_project_id)
                                    AND g.grantee_id <> p.owner_id) m), '{}')
        END)::text[] AS member_names
FROM "exagram"."projects" p
JOIN "exagram"."users" owner ON owner.id = p.owner_id
WHERE p.workspace_id = @workspace_id::uuid
  AND (p.owner_id = @user_id
       OR p.id IN (SELECT g.project_id FROM "exagram"."grants" g WHERE g.grantee_id = @user_id)
       OR p.parent_project_id IN (SELECT g.project_id FROM "exagram"."grants" g WHERE g.grantee_id = @user_id))
ORDER BY coalesce(p.parent_project_id::text, p.id::text), p.parent_project_id NULLS FIRST, p.name;

-- name: GetProjectById :one
SELECT id, workspace_id, owner_id, parent_project_id, name, created_at, redaction, publish_policy, link_preview,
       description AS source_description
FROM "exagram"."projects" WHERE id = @id;

-- name: RenameProject :one
UPDATE "exagram"."projects" SET name = @name
WHERE id = @id AND owner_id = @owner_id
RETURNING *;

-- name: MoveProject :one
UPDATE "exagram"."projects" SET parent_project_id = sqlc.narg('parent_project_id')
WHERE id = @id AND owner_id = @owner_id
RETURNING *;

-- name: DeleteProject :one
DELETE FROM "exagram"."projects"
WHERE id = @id AND owner_id = @owner_id
RETURNING id;

-- name: CountProjectContents :one
SELECT
  (SELECT count(*) FROM "exagram"."artifacts" a WHERE a.project_id = @id AND a.deleted_at IS NULL)::int AS artifact_count,
  (SELECT count(*) FROM "exagram"."projects" p WHERE p.parent_project_id = @id)::int AS child_count;

-- name: SetProjectPublishPolicy :one
UPDATE "exagram"."projects" SET publish_policy = @publish_policy::text
WHERE id = @id AND owner_id = @owner_id
RETURNING *;

-- name: SetProjectLinkPreview :one
UPDATE "exagram"."projects" SET link_preview = @link_preview::text
WHERE id = @id AND owner_id = @owner_id
RETURNING *;
