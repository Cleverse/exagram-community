-- Lists use visible_artifacts; single-artifact reads use visible_artifact so org access stays link-only.

-- name: ListVisibleArtifacts :many
SELECT artifact_id, revision_id, access
FROM "exagram".visible_artifacts(@p_kind::text, @p_id::uuid);

-- name: GetVisibleArtifact :one
-- p_unlock is the sha256 of the reader's unlock cookie for this Artifact, or NULL without one.
SELECT artifact_id, revision_id, access, download
FROM "exagram".visible_artifact(@p_kind::text, @p_id::uuid, @artifact_id::uuid, sqlc.narg('p_unlock')::text);

-- name: GetCommentableArtifact :one
-- The Comments boundary: a General Access row stands only for a user of the Artifact's own Workspace.
SELECT artifact_id, revision_id, access, download
FROM "exagram".commentable_artifact(@p_kind::text, @p_id::uuid, @artifact_id::uuid, sqlc.narg('p_unlock')::text);

-- name: GetAnyoneGate :one
-- Asked only after GetVisibleArtifact or GetCommentableArtifact found no row. 'password' or 'expired' when the
-- reader met the gate of an Artifact open to Anyone with the link, NULL when they met none.
SELECT "exagram".anyone_gate(@p_kind::text, @p_id::uuid, @artifact_id::uuid, sqlc.narg('p_unlock')::text) AS gate;

-- name: ListPendingRevisions :many
SELECT p.revision_id, p.artifact_id, p.seq, p.author_user_id, p.author_connection_id, p.created_at, p.is_approver
FROM "exagram".pending_revisions(@p_user_id::uuid) p
JOIN "exagram"."artifacts" a ON a.id = p.artifact_id
WHERE a.workspace_id = @workspace_id::uuid
ORDER BY p.created_at DESC;
