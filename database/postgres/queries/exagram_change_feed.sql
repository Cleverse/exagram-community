-- name: ListArtifactAudience :many
SELECT r.user_id::uuid AS user_id,
       "exagram".live_member(r.user_id, @workspace_id::uuid)::boolean AS member
FROM "exagram"."artifacts" a
CROSS JOIN LATERAL unnest("exagram".reach_set(a.id, a.owner_id, a.project_id)) AS r(user_id)
WHERE a.id = @artifact_id::uuid AND a.deleted_at IS NULL;
