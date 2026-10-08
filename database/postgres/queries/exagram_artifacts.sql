-- name: ListVisibleArtifactRows :many
SELECT a.id, a.workspace_id, a.owner_id, a.project_id, a.kind, a.title, a.current_revision_id,
       a.default_pin, a.deleted_at, a.created_at, a.title_tsv, a.redaction, a.publish_policy, a.general_access,
       v.revision_id AS visible_revision_id, v.access, v.pinned,
       w.name AS workspace_name, d.domain AS org_domain,
       "exagram".effective_publish_policy(a.id) AS effective_publish_policy,
       r.seq AS revision_seq,
       r.extraction_status AS revision_extraction_status,
       COALESCE(r.created_at, a.created_at) AS updated_at,
       owner.name AS owner_name,
       CASE WHEN "exagram".principal_live_member(@principal_kind, @principal_id, a.workspace_id)
            THEN (SELECT count(*) FROM "exagram"."grants" g WHERE g.artifact_id = a.id) ELSE 0 END AS shared_count,
       CASE WHEN "exagram".principal_live_member(@principal_kind, @principal_id, a.workspace_id)
            THEN (SELECT array_agg(shown.name ORDER BY shown.name)
          FROM "exagram"."grants" g
          JOIN "exagram"."users" u ON u.id = g.grantee_id
          CROSS JOIN LATERAL (SELECT CASE WHEN "exagram".grantee_pending(u.id, a.workspace_id)
                                          THEN lower(u.email::text) ELSE u.name END AS name) shown
         WHERE g.artifact_id = a.id) END AS shared_with_names,
       a.filename AS source_filename, a.description AS source_description,
       -- A list is Grant-only, so a row here is never one the Owner withheld download from.
       true AS can_download,
       a.anyone_password_on, a.anyone_password_hash IS NOT NULL AS anyone_password_set,
       a.anyone_expires_at, a.anyone_download
FROM "exagram"."visible_artifacts"(@principal_kind, @principal_id) v
JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
JOIN "exagram"."users" owner ON owner.id = a.owner_id
JOIN "exagram"."workspaces" w ON w.id = a.workspace_id
LEFT JOIN "exagram"."workspace_org_domains" d ON d.workspace_id = a.workspace_id
LEFT JOIN "exagram"."revisions" r ON r.id = v.revision_id
WHERE (
    @scope::text = 'all'
    OR (@scope::text = 'mine' AND v.access = 'owner')
    OR (@scope::text = 'sharedWithMe' AND v.access IN ('view', 'collaborate', 'edit'))
  )
  AND a.workspace_id = @workspace_id::uuid
  AND (sqlc.narg('kind')::text IS NULL OR a.kind = sqlc.narg('kind')::text)
  AND (sqlc.narg('project_id')::uuid IS NULL OR a.project_id = sqlc.narg('project_id')::uuid)
ORDER BY a.created_at DESC;

-- name: GetVisibleArtifactRow :one
SELECT a.id, a.workspace_id, a.owner_id, a.project_id, a.kind, a.title, a.current_revision_id,
       a.default_pin, a.deleted_at, a.created_at, a.title_tsv, a.redaction, a.publish_policy, a.general_access,
       v.revision_id AS visible_revision_id, v.access, v.pinned,
       w.name AS workspace_name,
       -- A General Access reader learns the Allowed Domain from nothing here: it is the Share dialog's, and they have none.
       CASE WHEN v.org_only THEN NULL ELSE d.domain END AS org_domain,
       "exagram".effective_publish_policy(a.id) AS effective_publish_policy,
       r.seq AS revision_seq,
       r.extraction_status AS revision_extraction_status,
       COALESCE(r.created_at, a.created_at) AS updated_at,
       owner.name AS owner_name,
       CASE WHEN v.org_only OR NOT "exagram".principal_live_member(@principal_kind, @principal_id, a.workspace_id)
            THEN 0 ELSE (SELECT count(*) FROM "exagram"."grants" g WHERE g.artifact_id = a.id) END AS shared_count,
       CASE WHEN v.org_only OR NOT "exagram".principal_live_member(@principal_kind, @principal_id, a.workspace_id)
            THEN NULL ELSE (SELECT array_agg(shown.name ORDER BY shown.name)
          FROM "exagram"."grants" g
          JOIN "exagram"."users" u ON u.id = g.grantee_id
          CROSS JOIN LATERAL (SELECT CASE WHEN "exagram".grantee_pending(u.id, a.workspace_id)
                                          THEN lower(u.email::text) ELSE u.name END AS name) shown
         WHERE g.artifact_id = a.id) END AS shared_with_names,
       a.filename AS source_filename, a.description AS source_description,
       v.download AS can_download,
       a.anyone_password_on, a.anyone_password_hash IS NOT NULL AS anyone_password_set,
       a.anyone_expires_at, a.anyone_download
FROM "exagram"."visible_artifact"(@principal_kind, @principal_id, @artifact_id, sqlc.narg('unlock')::text) v
JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
JOIN "exagram"."users" owner ON owner.id = a.owner_id
JOIN "exagram"."workspaces" w ON w.id = a.workspace_id
LEFT JOIN "exagram"."workspace_org_domains" d ON d.workspace_id = a.workspace_id
LEFT JOIN "exagram"."revisions" r ON r.id = v.revision_id
WHERE v.artifact_id = @artifact_id;

-- name: InsertArtifact :one
INSERT INTO "exagram"."artifacts" (workspace_id, owner_id, project_id, kind, title)
SELECT @workspace_id::uuid, @owner_id::uuid, sqlc.narg('project_id')::uuid, @kind::text, @title::text
WHERE "exagram".writer_in_workspace(@owner_id::uuid, @workspace_id::uuid)
RETURNING *;

-- name: GetOwnedArtifact :one
-- Owner-only reads (history, restore-as-new) go through the same definition of Owner the boundary
-- and the Approver use, so a Project Owner reaches an Artifact somebody else authored inside it.
SELECT * FROM "exagram"."artifacts"
WHERE id = @id AND "exagram".artifact_owner(id) = @owner_id;

-- name: MoveArtifact :one
UPDATE "exagram"."artifacts" SET project_id = sqlc.narg('project_id')
WHERE id = @id AND owner_id = @owner_id AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteArtifact :one
UPDATE "exagram"."artifacts" SET deleted_at = now()
WHERE id = @id AND owner_id = @owner_id AND deleted_at IS NULL
RETURNING *;

-- name: RestoreArtifact :one
UPDATE "exagram"."artifacts" SET deleted_at = NULL
WHERE id = @id AND owner_id = @owner_id AND deleted_at IS NOT NULL
RETURNING *;

-- name: SetArtifactPublishPolicy :one
-- NULL clears the override, so the Artifact follows its Project again. Only its Owner (ADR 0013's
-- artifact_owner) may change it; anyone else updates no row.
UPDATE "exagram"."artifacts" SET publish_policy = sqlc.narg('publish_policy')::text
WHERE id = @artifact_id::uuid AND deleted_at IS NULL AND "exagram".artifact_owner(id) = @user_id::uuid
RETURNING id;

-- name: SetArtifactGeneralAccess :one
UPDATE "exagram"."artifacts" a SET general_access = @general_access::text
WHERE a.id = @artifact_id::uuid AND a.deleted_at IS NULL
  AND "exagram".artifact_owner(a.id) = @user_id::uuid
  AND (@general_access::text <> 'org' OR "exagram".is_personal(a.workspace_id) OR EXISTS (
      SELECT 1 FROM "exagram"."workspace_org_domains" d WHERE d.workspace_id = a.workspace_id
  ))
RETURNING a.id;

-- name: SetArtifactAnyoneSettings :one
-- Only the Owner (artifact_owner, as for General Access) changes what Anyone with the link needs (ADR 0044). A
-- NULL argument leaves its column alone; clear_expiry is how the expiry is set to NULL. The CHECK on
-- anyone_password_on needs a hash, stored in this call or an earlier one.
UPDATE "exagram"."artifacts" a SET
  anyone_password_on = COALESCE(sqlc.narg('password_on')::boolean, a.anyone_password_on),
  anyone_password_hash = COALESCE(sqlc.narg('password_hash')::text, a.anyone_password_hash),
  anyone_expires_at = CASE WHEN @clear_expiry::boolean THEN NULL
                           ELSE COALESCE(sqlc.narg('expires_at')::timestamptz, a.anyone_expires_at) END,
  anyone_download = COALESCE(sqlc.narg('download')::boolean, a.anyone_download)
WHERE a.id = @artifact_id::uuid AND a.deleted_at IS NULL
  AND "exagram".artifact_owner(a.id) = @user_id::uuid
RETURNING a.id;
