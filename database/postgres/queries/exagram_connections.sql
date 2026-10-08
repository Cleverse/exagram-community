-- name: UpsertConnection :one
-- Re-consent for the same user and client narrows or widens the live Connection instead of
-- stacking a second row beside it; the partial unique index makes this atomic, unlike the
-- check-then-insert this replaced. A re-consent to a scope the Connection did not have stamps
-- scopes_widened_at, which the member's Notifications read (ADR 0040).
INSERT INTO "exagram"."connections" (user_id, oidc_client_id, oidc_grant_id, name, scopes, workspace_id)
SELECT @user_id::uuid, @oidc_client_id::text, @oidc_grant_id::text, @name::text, @scopes::text[], w.id
FROM "exagram"."workspaces" w
WHERE w.id = @workspace_id::uuid AND "exagram".writer_in_workspace(@user_id::uuid, w.id)
ON CONFLICT ("user_id", "oidc_client_id") WHERE "revoked_at" IS NULL
DO UPDATE SET oidc_grant_id = EXCLUDED.oidc_grant_id, name = EXCLUDED.name, scopes = EXCLUDED.scopes,
              workspace_id = EXCLUDED.workspace_id,
              scopes_widened_at = CASE WHEN EXCLUDED.scopes <@ "exagram"."connections".scopes
                                       THEN "exagram"."connections".scopes_widened_at
                                       ELSE now() END
RETURNING id, user_id, oidc_client_id, oidc_grant_id, name, scopes, revoked_at, created_at,
          folder_access, workspace_id,
          (SELECT count(*)::int FROM "exagram".connection_folder_entries(id)) AS folder_count;

-- name: ListConnectionsByUser :many
SELECT c.id, c.user_id, c.oidc_client_id, c.oidc_grant_id, c.name, c.scopes, c.revoked_at, c.created_at,
       c.folder_access, c.workspace_id,
       (CASE WHEN c.revoked_at IS NULL THEN (
           SELECT count(*)::int FROM "exagram".connection_folder_entries(c.id)
       ) ELSE 0 END)::int AS folder_count
FROM "exagram"."connections" c
WHERE c.user_id = @user_id::uuid
ORDER BY created_at DESC;

-- name: FindLiveConnectionByGrantId :one
SELECT c.id, c.user_id, c.oidc_client_id, c.oidc_grant_id, c.name, c.scopes, c.revoked_at, c.created_at,
       c.folder_access, c.workspace_id,
       (SELECT count(*)::int FROM "exagram".connection_folder_entries(c.id)) AS folder_count
FROM "exagram"."connections" c
WHERE c.oidc_grant_id = @oidc_grant_id::text AND c.revoked_at IS NULL
  AND "exagram".live_member(c.user_id, c.workspace_id);

-- name: FindLiveConnectionByUserAndClient :one
SELECT c.id, c.user_id, c.oidc_client_id, c.oidc_grant_id, c.name, c.scopes, c.revoked_at, c.created_at,
       c.folder_access, c.workspace_id,
       (SELECT count(*)::int FROM "exagram".connection_folder_entries(c.id)) AS folder_count
FROM "exagram"."connections" c
WHERE c.user_id = @user_id::uuid AND c.oidc_client_id = @oidc_client_id::text AND c.revoked_at IS NULL;

-- name: RevokeConnection :one
UPDATE "exagram"."connections" SET revoked_at = now()
WHERE id = @id::uuid AND user_id = @user_id::uuid AND revoked_at IS NULL
RETURNING id, oidc_grant_id;

-- name: RevokeLiveConnectionByGrantId :one
UPDATE "exagram"."connections" SET revoked_at = now()
WHERE oidc_grant_id = @oidc_grant_id::text AND revoked_at IS NULL
RETURNING id;

-- name: GetConnectionFolders :many
SELECT c.folder_access, c.other_files_access, f.project_id, f.access
FROM "exagram"."connections" c
LEFT JOIN LATERAL "exagram".connection_folder_entries(c.id) f ON true
WHERE c.id = @connection_id::uuid AND c.user_id = @user_id::uuid AND c.revoked_at IS NULL;

-- name: ListConnectionFolderEntries :many
SELECT project_id, access
FROM "exagram"."connection_folders"
WHERE connection_id = @connection_id::uuid
ORDER BY project_id;

-- name: UpdateConnectionFolderSettings :one
UPDATE "exagram"."connections"
SET folder_access = @folder_access::text, other_files_access = @other_files_access::text
WHERE id = @connection_id::uuid AND user_id = @user_id::uuid AND revoked_at IS NULL
RETURNING id;

-- name: DeleteConnectionFolders :exec
DELETE FROM "exagram"."connection_folders"
WHERE connection_id = @connection_id::uuid;

-- name: InsertConnectionFolder :one
INSERT INTO "exagram"."connection_folders" (connection_id, project_id, access)
SELECT @connection_id::uuid, p.id, @access::text
FROM "exagram"."projects" p
WHERE p.id = @project_id::uuid AND "exagram".connection_covers_workspace(@connection_id::uuid, p.workspace_id)
RETURNING project_id;

-- name: ListReachableProjectsForConnection :many
WITH reachable AS (
    SELECT p.id, p.name, p.parent_project_id, owner.name AS owner_name,
           "exagram".user_project_role(c.user_id, p.id) AS person_access
    FROM "exagram"."connections" c
    JOIN "exagram"."projects" p ON "exagram".connection_covers_workspace(c.id, p.workspace_id)
    JOIN "exagram"."users" owner ON owner.id = p.owner_id
    WHERE c.id = @connection_id::uuid AND c.user_id = @user_id::uuid
)
SELECT id, name, parent_project_id, owner_name, person_access
FROM reachable
WHERE person_access IS NOT NULL
ORDER BY coalesce(parent_project_id::text, id::text), parent_project_id NULLS FIRST, name;
