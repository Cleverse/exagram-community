-- name: ListWorkspaceGroups :many
WITH live AS (
	SELECT u.id, u.name FROM "exagram"."memberships" m
	JOIN "exagram"."users" u ON u.id = m.user_id
	WHERE m.workspace_id = @workspace_id::uuid AND "exagram".live_member(m.user_id, m.workspace_id)
)
SELECT g.id, g.name,
       coalesce(array_agg(l.id ORDER BY l.name, l.id) FILTER (WHERE l.id IS NOT NULL), '{}')::uuid[] AS member_ids,
       count(l.id)::int AS member_count
FROM "exagram"."groups" g
LEFT JOIN "exagram"."group_members" gm ON gm.group_id = g.id
LEFT JOIN live l ON l.id = gm.user_id
WHERE g.workspace_id = @workspace_id::uuid
  AND (sqlc.narg('group_id')::uuid IS NULL OR g.id = sqlc.narg('group_id')::uuid)
GROUP BY g.id
ORDER BY lower(g.name), g.id;

-- name: LockLiveMembersAmong :many
-- Locks each named live membership, in id order after lockTeamChange's, so a removal or a return to invited that
-- has not committed is waited on and then seen; the liveness test is on m itself so the recheck after the wait applies it.
SELECT m.user_id FROM "exagram"."memberships" m
WHERE m.user_id = ANY(@user_ids::uuid[]) AND m.workspace_id = @workspace_id::uuid
  AND m.removed_at IS NULL AND m.invited_at IS NULL
ORDER BY m.user_id
FOR SHARE OF m;

-- name: InsertGroup :one
INSERT INTO "exagram"."groups" (workspace_id, name, created_by)
VALUES (@workspace_id::uuid, @name::text, @created_by::uuid)
RETURNING id;

-- name: RenameGroup :one
UPDATE "exagram"."groups" SET name = @name::text
WHERE id = @id::uuid AND workspace_id = @workspace_id::uuid
RETURNING id;

-- name: DeleteGroupMembersExcept :many
DELETE FROM "exagram"."group_members"
WHERE group_id = @group_id::uuid AND NOT (user_id = ANY(@keep_user_ids::uuid[]))
RETURNING user_id;

-- name: InsertGroupMembers :many
INSERT INTO "exagram"."group_members" (group_id, user_id)
SELECT @group_id::uuid, unnest(@user_ids::uuid[])
ON CONFLICT DO NOTHING
RETURNING user_id;

-- name: DeleteGroup :one
DELETE FROM "exagram"."groups" WHERE id = @id::uuid AND workspace_id = @workspace_id::uuid RETURNING id;
