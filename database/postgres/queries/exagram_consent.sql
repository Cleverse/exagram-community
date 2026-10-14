-- name: ListConsentWorkspaces :many
SELECT w.id, w.kind, w.name
FROM "exagram"."memberships" m
JOIN "exagram"."workspaces" w ON w.id = m.workspace_id
WHERE m.user_id = @user_id::uuid AND "exagram".live_member(m.user_id, m.workspace_id)
ORDER BY (w.kind <> 'personal'), w.created_at;
