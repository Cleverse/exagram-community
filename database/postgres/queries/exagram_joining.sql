-- name: GetWorkspaceJoining :one
SELECT w.name, w.kind, w.join_mode, w.join_approval, w.member_invites, w.domain_link_enabled, w.domain_link_id,
	w.default_share_role, w.seat_limit, d.domain::text AS allowed_domain
FROM "exagram"."workspaces" w
LEFT JOIN "exagram"."workspace_org_domains" d ON d.workspace_id = w.id
WHERE w.id = @id::uuid;

-- name: LockWorkspaceJoining :one
-- NO KEY UPDATE: serialises settings writes and Seat checks without blocking inserts that reference the Workspace.
SELECT w.name, w.kind, w.join_mode, w.join_approval, w.member_invites, w.domain_link_enabled, w.domain_link_id,
	w.default_share_role, w.seat_limit, d.domain::text AS allowed_domain
FROM "exagram"."workspaces" w
LEFT JOIN "exagram"."workspace_org_domains" d ON d.workspace_id = w.id
WHERE w.id = @id::uuid
FOR NO KEY UPDATE OF w;

-- name: CountWorkspaceSeats :one
-- Members plus pending Invites, the ones the Invite list shows that have not expired. An expired Invite, or one its
-- inviter can no longer make, holds no Seat.
SELECT (
	(SELECT count(*) FROM "exagram"."memberships" m
		WHERE m.workspace_id = @workspace_id::uuid AND m.removed_at IS NULL AND m.invited_at IS NULL)
	+ (SELECT count(*) FROM "exagram"."workspace_invites" i
		WHERE i.workspace_id = @workspace_id::uuid AND i.expires_at > now()
			AND "exagram"."invite_usable"(i.invited_by, i.workspace_id, i.role, i.via))
	+ (SELECT count(*) FROM "exagram"."join_requests" r
		WHERE r.workspace_id = @workspace_id::uuid AND r.via = 'member_invite' AND r.declined_at IS NULL)
)::int AS used;

-- name: ListWorkspacesNamingDomain :many
SELECT w.id, w.join_mode
FROM "exagram"."workspace_org_domains" d
JOIN "exagram"."workspaces" w ON w.id = d.workspace_id
WHERE d.domain = @domain::citext
ORDER BY w.id
LIMIT 2;

-- name: GetEnabledDomainLink :one
SELECT w.id AS workspace_id, w.name AS workspace_name, d.domain::text AS allowed_domain
FROM "exagram"."workspaces" w
JOIN "exagram"."workspace_org_domains" d ON d.workspace_id = w.id
WHERE w.domain_link_id = @domain_link_id::uuid AND w.domain_link_enabled;
