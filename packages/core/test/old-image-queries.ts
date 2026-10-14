// Each statement is verbatim from packages/core/repository/postgres/gen/ at origin/main 5ae632ed, the last image before 000046.
export const OLD_IMAGE = {
	insertUser: `-- name: InsertUser :one
WITH created AS (
	INSERT INTO "exagram"."users" (workspace_id, email, name, password_hash, is_admin)
	VALUES ($1, $2, $3, $4, $5)
	RETURNING id, workspace_id, email, name, password_hash, is_admin, created_at, invited_at, removed_at, last_seen_at, joined_at, email_proven_legacy
), membership AS (
	INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, created_at)
	SELECT c.id, c.workspace_id, w.kind, CASE WHEN c.is_admin THEN 'admin' ELSE 'member' END, c.created_at
	FROM created c JOIN "exagram"."workspaces" w ON w.id = c.workspace_id
)
SELECT id, workspace_id, email, name, password_hash, is_admin, created_at, invited_at, removed_at, last_seen_at, joined_at, email_proven_legacy FROM created`,
	getUserByEmail: `-- name: GetUserByEmail :one
SELECT u.id, u.workspace_id, u.email, u.name, u.password_hash, u.is_admin, u.created_at, u.invited_at, u.removed_at, u.last_seen_at, u.joined_at, u.email_proven_legacy, EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
) AS google_linked, "exagram".has_live_membership(u.id)::boolean AS has_live_membership,
"exagram".live_team_of(u.id) AS live_team_id, "exagram".email_proven(u.id)::boolean AS email_proven
FROM "exagram"."users" u
WHERE u.email = $1`,
	getUserById: `-- name: GetUserById :one
SELECT u.id, m.workspace_id, u.email, u.name, u.password_hash, (m.role = 'admin')::boolean AS is_admin,
       u.created_at, m.invited_at, m.last_seen_at, m.joined_at,
       EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
) AS google_linked
FROM "exagram"."users" u
CROSS JOIN LATERAL (
	SELECT x.user_id, x.workspace_id, x.kind, x.role, x.joined_at, x.last_seen_at, x.removed_at, x.invited_at, x.created_at FROM "exagram"."memberships" x
	WHERE x.user_id = u.id AND "exagram".live_member(x.user_id, x.workspace_id)
	ORDER BY (x.workspace_id = u.workspace_id) DESC, (x.kind = 'team') DESC, x.workspace_id
	LIMIT 1
) m
WHERE u.id = $1`,
	getUserBySessionTokenHash: `-- name: GetUserBySessionTokenHash :one
SELECT u.id, s.id AS session_id, s.workspace_id, u.email, u.name, u.password_hash, (m.role = 'admin')::boolean AS is_admin,
       u.created_at, m.invited_at, m.last_seen_at, m.joined_at,
       EXISTS (
	SELECT 1 FROM "exagram"."user_identities" i
	WHERE i.user_id = u.id AND i.provider = 'google'
) AS google_linked
FROM "exagram"."sessions" s
JOIN "exagram"."users" u ON u.id = s.user_id
JOIN "exagram"."memberships" m ON m.user_id = u.id AND m.workspace_id = s.workspace_id
WHERE s.token_hash = $1 AND s.expires_at > now()
  AND "exagram".live_member(u.id, s.workspace_id)`,
	insertSession: `-- name: InsertSession :one
INSERT INTO "exagram"."sessions" (user_id, token_hash, expires_at, workspace_id)
SELECT m.user_id, $1, $2, m.workspace_id
FROM "exagram"."memberships" m
WHERE m.user_id = $3 AND "exagram".live_member(m.user_id, m.workspace_id)
ORDER BY (m.kind = 'team') DESC, m.workspace_id
LIMIT 1
RETURNING id, user_id, token_hash, expires_at, created_at, workspace_id`,
	touchUserLastSeen: `-- name: TouchUserLastSeen :exec
WITH membership AS (
	UPDATE "exagram"."memberships" SET last_seen_at = now()
	WHERE user_id = $1 AND workspace_id = $2::uuid AND removed_at IS NULL
	  AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')
	RETURNING user_id
)
UPDATE "exagram"."users" SET last_seen_at = now()
WHERE id = $1 AND workspace_id = $2::uuid AND EXISTS (SELECT 1 FROM membership)
  AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')`,
	promoteUserToAdmin: `-- name: PromoteUserToAdmin :exec
WITH membership AS (
	UPDATE "exagram"."memberships" SET role = 'admin'
	WHERE user_id = $1::uuid AND workspace_id = $2::uuid
	RETURNING user_id
)
UPDATE "exagram"."users" SET is_admin = true
WHERE id = $1::uuid AND workspace_id = $2::uuid AND EXISTS (SELECT 1 FROM membership)`,
	joinWorkspace: `-- name: JoinWorkspace :exec
WITH membership AS (
	INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, joined_at)
	SELECT $3::uuid, w.id, w.kind, $2::text, now()
	FROM "exagram"."workspaces" w WHERE w.id = $1::uuid
	ON CONFLICT (user_id, workspace_id) DO UPDATE
	SET removed_at = NULL, invited_at = NULL, role = EXCLUDED.role, joined_at = now()
	RETURNING user_id
), other_team_invitations AS (
	DELETE FROM "exagram"."memberships"
	WHERE user_id = $3::uuid AND workspace_id <> $1::uuid AND invited_at IS NOT NULL
	  AND removed_at IS NULL
)
UPDATE "exagram"."users" SET workspace_id = $1::uuid, is_admin = ($2::text = 'admin'), removed_at = NULL
WHERE id = $3::uuid AND EXISTS (SELECT 1 FROM membership)`,
	setPasswordHash: `-- name: SetPasswordHash :one
UPDATE "exagram"."users"
SET password_hash = $1::text
WHERE id = $2::uuid AND invited_at IS NULL
RETURNING id`,
	lockAccountForJoin: `-- name: LockAccountForJoin :one
SELECT u.id, "exagram".live_team_of(u.id)::uuid AS live_team_id,
	($1::text IS NOT NULL AND u.password_hash = $1::text)::boolean
		AS holds_password
FROM "exagram"."users" u
WHERE u.id = $2::uuid AND u.invited_at IS NULL
FOR NO KEY UPDATE OF u`,
	claimUnclaimedAccount: `-- name: ClaimUnclaimedAccount :one
SELECT "exagram".claim_unclaimed_account($1::uuid, $2::text, $3::text)::uuid
	AS id`,
	findConsentUserBySessionTokenHash: `-- name: FindConsentUserBySessionTokenHash :one
SELECT u.id, u.email, u.name, u.workspace_id
FROM "exagram"."sessions" s
JOIN "exagram"."users" u ON u.id = s.user_id
WHERE s.token_hash = $1::text AND s.expires_at > now()`,
	insertInvitedMember: `-- name: InsertInvitedMember :one
WITH created AS (
	INSERT INTO "exagram"."users" (workspace_id, email, name, password_hash, is_admin, invited_at)
	VALUES ($1::uuid, $2::citext, $3::text, $4::text, false, now())
	ON CONFLICT (email) DO NOTHING
	RETURNING id
), invitee AS (
	SELECT id FROM created
	UNION ALL
	SELECT u.id FROM "exagram"."users" u
	WHERE u.email = $2::citext AND NOT EXISTS (SELECT 1 FROM created)
	  AND NOT "exagram".has_live_membership(u.id)
), membership AS (
	INSERT INTO "exagram"."memberships" (user_id, workspace_id, kind, role, invited_at)
	SELECT i.id, w.id, w.kind, 'member', now()
	FROM invitee i JOIN "exagram"."workspaces" w ON w.id = $1::uuid AND w.kind = 'team'
	ON CONFLICT (user_id, workspace_id) DO NOTHING
), rehomed AS (
	UPDATE "exagram"."users" u SET workspace_id = $1::uuid
	FROM invitee i
	WHERE u.id = i.id AND u.invited_at IS NOT NULL AND "exagram".is_personal(u.workspace_id)
	  AND NOT "exagram".is_personal($1::uuid)
)
SELECT id FROM invitee`,
	releaseInvitedMembership: `-- name: ReleaseInvitedMembership :exec
WITH released AS (
	DELETE FROM "exagram"."memberships" m
	WHERE m.user_id = $2::uuid AND m.workspace_id = $1::uuid
	  AND m.invited_at IS NOT NULL AND m.removed_at IS NULL
	  AND NOT EXISTS (
		SELECT 1 FROM "exagram"."grants" g
		LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
		WHERE g.grantee_id = m.user_id AND COALESCE(a.workspace_id, p.workspace_id) = m.workspace_id
	  )
	RETURNING m.user_id
), still_invited AS (
	SELECT m.workspace_id FROM "exagram"."memberships" m
	WHERE m.user_id = $2::uuid AND m.workspace_id <> $1::uuid
	  AND m.invited_at IS NOT NULL AND m.removed_at IS NULL
	ORDER BY m.created_at, m.workspace_id
	LIMIT 1
), leaving AS (
	SELECT user_id FROM released
	UNION
	SELECT u.id FROM "exagram"."users" u
	WHERE u.id = $2::uuid AND "exagram".is_personal($1::uuid)
	  AND NOT EXISTS (SELECT 1 FROM "exagram"."user_identities" i WHERE i.user_id = u.id)
), new_home AS (
	SELECT COALESCE(
		(SELECT workspace_id FROM still_invited),
		(SELECT COALESCE(a.workspace_id, p.workspace_id)
		 FROM "exagram"."grants" g
		 LEFT JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
		 LEFT JOIN "exagram"."projects" p ON p.id = g.project_id
		 WHERE g.grantee_id = $2::uuid AND NOT g.dormant AND "exagram".is_personal(COALESCE(a.workspace_id, p.workspace_id))
		 ORDER BY g.created_at, g.id
		 LIMIT 1)
	) AS workspace_id
), rehomed AS (
	UPDATE "exagram"."users" u SET workspace_id = (SELECT workspace_id FROM new_home)
	FROM leaving
	WHERE u.id = leaving.user_id AND u.invited_at IS NOT NULL AND u.workspace_id = $1::uuid
	  AND (SELECT workspace_id FROM new_home) IS NOT NULL
)
DELETE FROM "exagram"."users" u
USING leaving
WHERE u.id = leaving.user_id AND u.invited_at IS NOT NULL
  AND NOT EXISTS (
	SELECT 1 FROM "exagram"."memberships" m WHERE m.user_id = u.id AND m.workspace_id <> $1::uuid
  )
  AND NOT EXISTS (SELECT 1 FROM "exagram"."grants" g WHERE g.grantee_id = u.id)`,
	listProjectGrantRolesForUser: `-- name: ListProjectGrantRolesForUser :many
SELECT g.role
FROM "exagram"."grants" g
JOIN "exagram"."projects" p ON p.id = $1::uuid
WHERE g.grantee_id = $2::uuid AND NOT g.dormant AND g.project_id IN (p.id, p.parent_project_id)`,
	hasPinnedGrantUnderProject: `-- name: HasPinnedGrantUnderProject :one
SELECT EXISTS (
  SELECT 1
  FROM "exagram"."grants" g
  JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
  WHERE g.grantee_id = $1::uuid
    AND g.pinned_revision_id IS NOT NULL AND NOT g.dormant
    AND a.deleted_at IS NULL
    AND (
      a.project_id = $2::uuid
      OR a.project_id IN (SELECT cp.id FROM "exagram"."projects" cp WHERE cp.parent_project_id = $2::uuid)
    )
) AS pinned`,
	lockOrphanInvitedMembers: `-- name: LockOrphanInvitedMembers :many
WITH orphans AS (
	SELECT u.id FROM "exagram"."users" u
	WHERE u.invited_at IS NOT NULL
	  AND u.invited_at < $1::timestamptz
	  AND NOT EXISTS (SELECT 1 FROM "exagram"."grants" g WHERE g.grantee_id = u.id)
	  AND NOT EXISTS (SELECT 1 FROM "exagram"."user_identities" i WHERE i.user_id = u.id)
), locked AS (
	SELECT m.user_id FROM "exagram"."memberships" m
	WHERE m.user_id IN (SELECT id FROM orphans)
	ORDER BY m.user_id, m.workspace_id
	FOR NO KEY UPDATE SKIP LOCKED
), locked_counts AS (
	SELECT user_id, count(*) AS n FROM locked GROUP BY user_id
), held_counts AS (
	SELECT m.user_id, count(*) AS n FROM "exagram"."memberships" m
	WHERE m.user_id IN (SELECT id FROM orphans)
	GROUP BY m.user_id
), bare_candidates AS MATERIALIZED (
	SELECT u.id, u.email FROM "exagram"."users" u
	WHERE u.id IN (SELECT id FROM orphans) AND "exagram".bare_account(u.id)
), bare AS (
	SELECT c.id FROM bare_candidates c
	WHERE pg_try_advisory_xact_lock(hashtext('bare:' || lower(c.email::text)))
)
SELECT u.id, COALESCE(lc.n, 0)::int AS memberships
FROM "exagram"."users" u
LEFT JOIN locked_counts lc ON lc.user_id = u.id
LEFT JOIN held_counts hc ON hc.user_id = u.id
WHERE u.id IN (SELECT id FROM orphans)
  AND (
    EXISTS (SELECT 1 FROM bare b WHERE b.id = u.id)
    OR (lc.n IS NOT NULL AND lc.n = hc.n)
  )
FOR UPDATE OF u SKIP LOCKED`,
	deleteLockedOrphanInvitedMembers: `-- name: DeleteLockedOrphanInvitedMembers :many
DELETE FROM "exagram"."users" u
USING unnest($1::uuid[], $2::int[]) AS l(id, memberships)
WHERE u.id = l.id
  AND u.invited_at IS NOT NULL
  AND u.invited_at < $3::timestamptz
  AND NOT EXISTS (SELECT 1 FROM "exagram"."grants" g WHERE g.grantee_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM "exagram"."user_identities" i WHERE i.user_id = u.id)
  AND (SELECT count(*) FROM "exagram"."memberships" m WHERE m.user_id = u.id) = l.memberships
RETURNING u.id`,
	mcpInsertArtifact: `-- name: McpInsertArtifact :one
INSERT INTO "exagram"."artifacts" (id, workspace_id, owner_id, project_id, kind, title)
SELECT coalesce($1::uuid, gen_random_uuid()), p.workspace_id, p.owner_id, p.id, $2::text, $3::text
FROM "exagram"."connections" c
JOIN "exagram"."projects" p ON p.id = $4::uuid
WHERE c.id = $5::uuid AND c.revoked_at IS NULL
  AND p.owner_id = $6::uuid
  AND "exagram".writer_in_workspace(p.owner_id, p.workspace_id)
  AND "exagram".writer_in_workspace(c.user_id, p.workspace_id)
  AND "exagram".connection_project_right(c.id, p.id) = 'edit'
  AND (
	p.owner_id = c.user_id
	OR EXISTS (
		SELECT 1 FROM "exagram"."grants" g
		WHERE g.grantee_id = c.user_id AND g.role = 'edit' AND NOT g.dormant
		  AND g.project_id IN (p.id, p.parent_project_id)
	)
  )
RETURNING id`,
	mcpInsertPendingUpload: `-- name: McpInsertPendingUpload :one
INSERT INTO "exagram"."mcp_pending_uploads" (storage_key, artifact_id, connection_id, project_id, kind, title, mime, bytes)
SELECT $1::text, $2::uuid, c.id, p.id, $3::text, $4::text, $5::text, $6::int
FROM "exagram"."connections" c
JOIN "exagram"."projects" p ON p.id = $7::uuid
WHERE c.id = $8::uuid AND c.revoked_at IS NULL
  AND "exagram".writer_in_workspace(p.owner_id, p.workspace_id)
  AND "exagram".writer_in_workspace(c.user_id, p.workspace_id)
  AND "exagram".connection_project_right(c.id, p.id) = 'edit'
  AND (
	p.owner_id = c.user_id
	OR EXISTS (
		SELECT 1 FROM "exagram"."grants" g
		WHERE g.grantee_id = c.user_id AND g.role = 'edit' AND NOT g.dormant
		  AND g.project_id IN (p.id, p.parent_project_id)
	)
  )
RETURNING artifact_id`,
	setMemberAdmin: `-- name: SetMemberAdmin :one
WITH membership AS (
	UPDATE "exagram"."memberships" SET role = CASE WHEN $1::boolean THEN 'admin' ELSE 'member' END
	WHERE user_id = $2::uuid AND workspace_id = $3::uuid
	RETURNING user_id
), mirror AS (
	UPDATE "exagram"."users" u SET is_admin = $1::boolean
	FROM membership WHERE u.id = membership.user_id AND u.workspace_id = $3::uuid
)
SELECT user_id AS id FROM membership`,
	markMemberRemoved: `-- name: MarkMemberRemoved :one
WITH membership AS (
	UPDATE "exagram"."memberships" SET removed_at = now()
	WHERE user_id = $1::uuid AND workspace_id = $2::uuid AND removed_at IS NULL
	RETURNING user_id, invited_at
), home AS (
	-- Removed from their home Team, a person is at home in their Personal Workspace, which they keep.
	UPDATE "exagram"."users" u
	SET workspace_id = "exagram".ensure_personal_workspace(u.id), is_admin = true
	FROM membership
	WHERE u.id = membership.user_id AND membership.invited_at IS NULL AND u.workspace_id = $2::uuid
)
SELECT user_id AS id FROM membership`,
	lockLegacyHomeUserRow: `-- name: LockLegacyHomeUserRow :many
SELECT id FROM "exagram"."users" WHERE id = $1::uuid AND workspace_id = $2::uuid FOR NO KEY UPDATE`,
	startNotificationEmailDeliveries: `-- name: StartNotificationEmailDeliveries :many
INSERT INTO "exagram"."notification_email_deliveries" ("user_id", "cursor_at", "last_digest_on", "checked_at")
SELECT u.id,
       $1::timestamptz,
       CASE
         WHEN extract(hour FROM $1::timestamptz AT TIME ZONE COALESCE(np.time_zone, 'UTC')) >= COALESCE(np.digest_hour, 8)
         THEN ($1::timestamptz AT TIME ZONE COALESCE(np.time_zone, 'UTC'))::date
       END,
       $1::timestamptz
FROM "exagram"."users" u
LEFT JOIN "exagram"."notification_preferences" np ON np.user_id = u.id
WHERE u.invited_at IS NULL AND "exagram".has_live_membership(u.id)
  AND EXISTS (
	SELECT 1 FROM "exagram"."memberships" m
	JOIN "exagram"."workspaces" w ON w.id = m.workspace_id
	WHERE m.user_id = u.id AND w.notification_email_enabled AND "exagram".live_member(m.user_id, m.workspace_id)
  )
  AND COALESCE(np.email_cadence, 'daily') <> 'off'
  AND "exagram".notification_email_verified(u.id)
  AND NOT EXISTS (SELECT 1 FROM "exagram"."notification_email_deliveries" d WHERE d.user_id = u.id)
ON CONFLICT ("user_id") DO NOTHING
RETURNING "user_id"`,
	claimDueNotificationEmails: `-- name: ClaimDueNotificationEmails :many
SELECT d.user_id,
       u.email::text AS address,
       COALESCE(np.email_cadence, 'daily')::text AS cadence,
       COALESCE(np.email_access_requests, true)::boolean AS access_requests,
       COALESCE(np.email_pending_revisions, true)::boolean AS pending_revisions,
       COALESCE(np.email_grants, true)::boolean AS grants,
       COALESCE(np.email_comments, true)::boolean AS comments,
       COALESCE(np.time_zone, 'UTC')::text AS time_zone,
       to_char(d.cursor_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
       d.cursor_id,
       to_char(($1::timestamptz AT TIME ZONE COALESCE(np.time_zone, 'UTC'))::date, 'YYYY-MM-DD') AS local_date
FROM "exagram"."notification_email_deliveries" d
JOIN "exagram"."users" u ON u.id = d.user_id
LEFT JOIN "exagram"."notification_preferences" np ON np.user_id = d.user_id
WHERE u.invited_at IS NULL AND "exagram".has_live_membership(u.id)
  AND EXISTS (
	SELECT 1 FROM "exagram"."memberships" m
	JOIN "exagram"."workspaces" w ON w.id = m.workspace_id
	WHERE m.user_id = u.id AND w.notification_email_enabled AND "exagram".live_member(m.user_id, m.workspace_id)
  )
  AND d.checked_at < $1::timestamptz
  AND "exagram".notification_email_verified(u.id)
  AND (COALESCE(np.email_cadence, 'daily') = 'immediate'
       OR (COALESCE(np.email_cadence, 'daily') = 'daily'
           AND extract(hour FROM $1::timestamptz AT TIME ZONE COALESCE(np.time_zone, 'UTC')) >= COALESCE(np.digest_hour, 8)
           AND (d.last_digest_on IS NULL
                OR d.last_digest_on < ($1::timestamptz AT TIME ZONE COALESCE(np.time_zone, 'UTC'))::date)))
ORDER BY d.checked_at, d.user_id
LIMIT $2::int
FOR UPDATE OF d SKIP LOCKED`,
	isNotificationEmailSendable: `-- name: IsNotificationEmailSendable :one
SELECT EXISTS (
	SELECT 1
	FROM "exagram"."users" u
	LEFT JOIN "exagram"."notification_preferences" np ON np.user_id = u.id
	WHERE u.id = $1::uuid
	  AND u.invited_at IS NULL AND "exagram".has_live_membership(u.id)
	  AND lower(u.email::text) = lower($2::text)
	  AND NOT EXISTS (
		SELECT 1 FROM "exagram"."workspaces" w
		WHERE NOT w.notification_email_enabled
		  AND (w.id = ANY ($3::uuid[])
			OR (cardinality($3::uuid[]) = 0 AND w.id = u.workspace_id))
	  )
	  AND COALESCE(np.email_cadence, 'daily') <> 'off'
	  AND "exagram".notification_email_verified(u.id)
)::boolean AS sendable`,
	listNotificationsSince: `-- name: ListNotificationsSince :many
WITH pref AS (
	SELECT $6::boolean AS access_requests,
	       $7::boolean AS pending_revisions,
	       $8::boolean AS grants,
	       $9::boolean AS comments,
	       $10::boolean AS decisions,
	       $11::boolean AS published,
	       $12::boolean AS connections,
	       $13::text AS revision_scope
),
muted AS MATERIALIZED (
	SELECT p.id
	FROM "exagram"."notification_muted_projects" m
	JOIN "exagram"."projects" p ON m.project_id IN (p.id, p.parent_project_id)
	WHERE m.user_id = $1::uuid
),
visible AS MATERIALIZED (
	SELECT v.artifact_id, v.revision_id, v.pinned
	FROM "exagram"."visible_artifacts"('user', $1::uuid) v
	WHERE ((SELECT grants FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."grants" ng
	                    WHERE ng.grantee_id = $1::uuid AND NOT ng.dormant
	                      AND ng.artifact_id IS NOT NULL
	                      AND ng.created_by <> $1::uuid
	                      AND COALESCE(ng.woken_at, ng.created_at) >= $14::timestamptz))
	   OR ((SELECT comments FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."comments" nc
	                    WHERE nc.author_id <> $1::uuid
	                      AND nc.created_at >= $14::timestamptz))
	   OR ((SELECT published FROM pref)
	       AND (SELECT revision_scope FROM pref) <> 'mine'
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."revisions" nr
	                    WHERE nr.approved_at >= $14::timestamptz
	                      AND nr.author_user_id <> $1::uuid))
	   OR ((SELECT decisions FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."access_requests" nar
	                    WHERE nar.requester_id = $1::uuid
	                      AND nar.resolution = 'granted'
	                      AND nar.resolved_at >= $14::timestamptz))
),
items AS (
	SELECT r.id, 'accessRequest'::text AS kind, a.id AS artifact_id, NULL::uuid AS project_id,
	       a.title, u.name AS actor_name, NULL::int AS revision, r.role, NULL::text AS outcome,
	       NULL::text AS subject, r.note, r.created_at
	FROM "exagram"."access_requests" r
	JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	JOIN "exagram"."users" u ON u.id = r.requester_id
	WHERE (SELECT access_requests FROM pref)
	  AND a.owner_id = $1::uuid
	  AND a.deleted_at IS NULL
	  AND r.resolved_at IS NULL
	  AND "exagram".live_member(u.id, a.workspace_id)
	  AND NOT "exagram".reaches_artifact(u.id, a.id)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND r.created_at >= $14::timestamptz

	UNION ALL

	SELECT p.revision_id, 'pendingRevision'::text, p.artifact_id, NULL::uuid,
	       a.title,
	       COALESCE(CASE WHEN p.author_user_id = $1::uuid THEN c.name END, u.name),
	       p.seq, NULL::text, NULL::text, NULL::text, NULL::text,
	       p.created_at
	FROM "exagram"."pending_revisions"($1::uuid) p
	JOIN "exagram"."artifacts" a ON a.id = p.artifact_id
	JOIN "exagram"."users" u ON u.id = p.author_user_id
	LEFT JOIN "exagram"."connections" c ON c.id = p.author_connection_id
	WHERE (SELECT pending_revisions FROM pref)
	  AND p.is_approver
	  AND NOT (p.author_user_id = $1::uuid AND p.author_connection_id IS NULL)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND p.created_at >= $14::timestamptz

	UNION ALL

	SELECT g.id, 'grant'::text, a.id, NULL::uuid,
	       a.title,
	       CASE
	         WHEN g.created_by = a.owner_id
	           OR EXISTS (SELECT 1
	                        FROM "exagram"."grants" sg
	                       WHERE sg.artifact_id = a.id
	                         AND sg.grantee_id = g.created_by AND NOT sg.dormant)
	         THEN u.name
	       END,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       COALESCE(g.woken_at, g.created_at)
	FROM "exagram"."grants" g
	JOIN visible v ON v.artifact_id = g.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	JOIN "exagram"."users" u ON u.id = g.created_by
	WHERE (SELECT grants FROM pref)
	  AND g.grantee_id = $1::uuid AND NOT g.dormant
	  AND g.created_by <> $1::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  -- The decision is sent under the same conditions as this row (visible, not muted) plus its own switch.
	  AND NOT ((SELECT decisions FROM pref)
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."access_requests" ar
	                        WHERE ar.artifact_id = g.artifact_id
	                          AND ar.requester_id = $1::uuid
	                          AND ar.resolution = 'granted'
	                          AND ar.resolved_at = g.created_at))
	  AND COALESCE(g.woken_at, g.created_at) >= $14::timestamptz

	UNION ALL

	SELECT g.id, 'grant'::text, NULL::uuid, p.id,
	       p.name,
	       CASE
	         WHEN g.created_by = p.owner_id THEN u.name
	         WHEN (p.owner_id = $1::uuid
	               OR EXISTS (SELECT 1
	                            FROM "exagram"."grants" mine
	                           WHERE mine.grantee_id = $1::uuid AND NOT mine.dormant
	                             AND mine.project_id IN (p.id, p.parent_project_id)
	                             AND mine.role IN ('edit', 'collaborate')))
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."grants" mg
	                        WHERE mg.project_id IN (p.id, p.parent_project_id)
	                          AND mg.grantee_id = g.created_by AND NOT mg.dormant
	                          AND mg.grantee_id <> p.owner_id)
	         THEN u.name
	       END,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       COALESCE(g.woken_at, g.created_at)
	FROM "exagram"."grants" g
	JOIN "exagram"."projects" p ON p.id = g.project_id
	JOIN "exagram"."users" u ON u.id = g.created_by
	WHERE (SELECT grants FROM pref)
	  AND g.grantee_id = $1::uuid AND NOT g.dormant
	  AND g.created_by <> $1::uuid
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = p.id)
	  AND COALESCE(g.woken_at, g.created_at) >= $14::timestamptz

	UNION ALL

	SELECT c.id, 'comment'::text, a.id, NULL::uuid,
	       a.title, u.name,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       c.created_at
	FROM visible v
	JOIN "exagram"."comments" c ON c.revision_id = v.revision_id
	JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
	JOIN "exagram"."users" u ON u.id = c.author_id
	WHERE (SELECT comments FROM pref)
	  AND c.author_id <> $1::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND c.created_at >= $14::timestamptz

	UNION ALL

	SELECT r.id, 'decision'::text, a.id, NULL::uuid,
	       a.title, o.name,
	       NULL::int, g.role, 'granted'::text, 'accessRequest'::text, NULL::text,
	       r.resolved_at
	FROM "exagram"."access_requests" r
	JOIN visible v ON v.artifact_id = r.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	JOIN "exagram"."users" o ON o.id = a.owner_id
	JOIN "exagram"."grants" g ON g.artifact_id = a.id AND g.grantee_id = $1::uuid AND NOT g.dormant
	WHERE (SELECT decisions FROM pref)
	  AND r.requester_id = $1::uuid
	  AND r.resolution = 'granted'
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND r.resolved_at >= $14::timestamptz

	UNION ALL

	SELECT r.id, 'decision'::text, r.artifact_id, NULL::uuid,
	       ''::text, NULL::text,
	       NULL::int, NULL::text, 'declined'::text, 'accessRequest'::text, NULL::text,
	       r.resolved_at
	FROM "exagram"."access_requests" r
	WHERE (SELECT decisions FROM pref)
	  AND r.requester_id = $1::uuid
	  AND r.resolution = 'dismissed'
	  AND r.resolved_at >= $14::timestamptz

	UNION ALL

	SELECT rv.id, 'decision'::text, a.id, NULL::uuid,
	       a.title,
	       -- The approver is the Artifact's Owner, or the Owner of its folder, whom the author sees in the
	       -- folder list when they reach the folder.
	       CASE
	         WHEN o.id = a.owner_id THEN o.name
	         WHEN a.project_id IS NOT NULL
	           AND "exagram".user_project_role($1::uuid, a.project_id) IS NOT NULL
	         THEN o.name
	       END,
	       rv.seq, NULL::text,
	       CASE WHEN rv.status = 'approved' THEN 'approved' ELSE 'discarded' END,
	       'revision'::text, NULL::text,
	       COALESCE(rv.discarded_at, rv.approved_at)
	FROM "exagram"."revisions" rv
	JOIN "exagram"."artifacts" a ON a.id = rv.artifact_id
	JOIN "exagram"."users" o ON o.id = "exagram".artifact_owner(a.id)
	WHERE (SELECT decisions FROM pref)
	  AND rv.author_user_id = $1::uuid
	  AND ((rv.status = 'approved' AND rv.approved_at > rv.created_at AND rv.approved_at >= $14::timestamptz)
	       OR (rv.status = 'discarded' AND rv.discarded_at >= $14::timestamptz))
	  AND a.deleted_at IS NULL
	  AND o.id <> $1::uuid
	  AND "exagram".reaches_artifact($1::uuid, a.id)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)

	UNION ALL

	SELECT rv.id, 'published'::text, a.id, NULL::uuid,
	       a.title,
	       CASE
	         WHEN rv.author_user_id = a.owner_id THEN u.name
	         WHEN EXISTS (SELECT 1
	                        FROM "exagram"."grants" sg
	                       WHERE sg.artifact_id = a.id
	                         AND sg.grantee_id = rv.author_user_id AND NOT sg.dormant
	                         AND sg.role IN ('edit', 'collaborate'))
	         THEN u.name
	         WHEN fp.id IS NOT NULL
	           AND (fp.owner_id = $1::uuid
	                OR EXISTS (SELECT 1
	                             FROM "exagram"."grants" mine
	                            WHERE mine.grantee_id = $1::uuid AND NOT mine.dormant
	                              AND mine.project_id IN (fp.id, fp.parent_project_id)
	                              AND mine.role IN ('edit', 'collaborate')))
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."grants" mg
	                        WHERE mg.project_id IN (fp.id, fp.parent_project_id)
	                          AND mg.grantee_id = rv.author_user_id AND NOT mg.dormant
	                          AND mg.role IN ('edit', 'collaborate'))
	         THEN u.name
	       END,
	       rv.seq, NULL::text, NULL::text, NULL::text, NULL::text,
	       rv.approved_at
	FROM visible v
	JOIN "exagram"."revisions" rv ON rv.artifact_id = v.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
	JOIN "exagram"."users" u ON u.id = rv.author_user_id
	LEFT JOIN "exagram"."projects" fp ON fp.id = a.project_id
	WHERE (SELECT published FROM pref)
	  AND (SELECT revision_scope FROM pref) <> 'mine'
	  AND NOT v.pinned
	  AND rv.status = 'approved'
	  AND rv.author_user_id <> $1::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND ((SELECT revision_scope FROM pref) = 'all'
	       OR EXISTS (SELECT 1
	                    FROM "exagram"."grants" dg
	                   WHERE dg.artifact_id = a.id
	                     AND dg.grantee_id = $1::uuid AND NOT dg.dormant)
	       OR (fp.id IS NOT NULL
	           AND ("exagram".user_project_role($1::uuid, fp.id) IS NOT NULL
	                OR "exagram".user_project_role($1::uuid, fp.parent_project_id) IS NOT NULL)))
	  AND rv.approved_at >= $14::timestamptz

	UNION ALL

	SELECT c.id, 'connection'::text, NULL::uuid, NULL::uuid,
	       c.name, NULL::text,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       GREATEST(c.created_at, c.scopes_widened_at)
	FROM "exagram"."connections" c
	WHERE (SELECT connections FROM pref)
	  AND c.user_id = $1::uuid
	  AND c.revoked_at IS NULL
	  AND GREATEST(c.created_at, c.scopes_widened_at) >= $14::timestamptz
)
SELECT items.id, items.kind, items.artifact_id, items.project_id, items.title, items.actor_name, items.revision,
       items.role, items.outcome, items.subject, items.note, items.created_at,
       to_char(items.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
FROM items
CROSS JOIN LATERAL (
	SELECT COALESCE(
	        (SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = items.artifact_id),
	        (SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = items.project_id),
	        (SELECT c.workspace_id FROM "exagram"."connections" c WHERE c.id = items.id AND items.kind = 'connection')
	       ) AS workspace_id,
	       COALESCE(
	        (SELECT a.owner_id FROM "exagram"."artifacts" a WHERE a.id = items.artifact_id),
	        (SELECT p.owner_id FROM "exagram"."projects" p WHERE p.id = items.project_id),
	        (SELECT c.user_id FROM "exagram"."connections" c WHERE c.id = items.id AND items.kind = 'connection')
	       ) AS owner_id
) item
WHERE "exagram".principal_scope_covers('user', $1::uuid, $2::uuid, item.workspace_id)
  AND (item.workspace_id = $2::uuid OR item.owner_id IS DISTINCT FROM $1::uuid)
  AND ($3::uuid IS NULL
       OR (items.created_at, items.id) > ($4::text::timestamptz, $3::uuid))
ORDER BY items.created_at ASC, items.id ASC
LIMIT $5::int`,
	listNotificationEmailItems: `-- name: ListNotificationEmailItems :many
WITH pref AS (
	SELECT $5::boolean AS access_requests,
	       $6::boolean AS pending_revisions,
	       $7::boolean AS grants,
	       $8::boolean AS comments,
	       $9::boolean AS decisions,
	       $10::boolean AS published,
	       $11::boolean AS connections,
	       $12::text AS revision_scope
),
muted AS MATERIALIZED (
	SELECT p.id
	FROM "exagram"."notification_muted_projects" m
	JOIN "exagram"."projects" p ON m.project_id IN (p.id, p.parent_project_id)
	WHERE m.user_id = $13::uuid
),
visible AS MATERIALIZED (
	SELECT v.artifact_id, v.revision_id, v.pinned
	FROM "exagram"."visible_artifacts"('user', $13::uuid) v
	WHERE ((SELECT grants FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."grants" ng
	                    WHERE ng.grantee_id = $13::uuid AND NOT ng.dormant
	                      AND ng.artifact_id IS NOT NULL
	                      AND ng.created_by <> $13::uuid
	                      AND COALESCE(ng.woken_at, ng.created_at) >= $14::timestamptz))
	   OR ((SELECT comments FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."comments" nc
	                    WHERE nc.author_id <> $13::uuid
	                      AND nc.created_at >= $14::timestamptz))
	   OR ((SELECT published FROM pref)
	       AND (SELECT revision_scope FROM pref) <> 'mine'
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."revisions" nr
	                    WHERE nr.approved_at >= $14::timestamptz
	                      AND nr.author_user_id <> $13::uuid))
	   OR ((SELECT decisions FROM pref)
	       AND EXISTS (SELECT 1
	                     FROM "exagram"."access_requests" nar
	                    WHERE nar.requester_id = $13::uuid
	                      AND nar.resolution = 'granted'
	                      AND nar.resolved_at >= $14::timestamptz))
),
items AS (
	SELECT r.id, 'accessRequest'::text AS kind, a.id AS artifact_id, NULL::uuid AS project_id,
	       a.title, u.name AS actor_name, NULL::int AS revision, r.role, NULL::text AS outcome,
	       NULL::text AS subject, r.note, r.created_at
	FROM "exagram"."access_requests" r
	JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	JOIN "exagram"."users" u ON u.id = r.requester_id
	WHERE (SELECT access_requests FROM pref)
	  AND a.owner_id = $13::uuid
	  AND a.deleted_at IS NULL
	  AND r.resolved_at IS NULL
	  AND "exagram".live_member(u.id, a.workspace_id)
	  AND NOT "exagram".reaches_artifact(u.id, a.id)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND r.created_at >= $14::timestamptz

	UNION ALL

	SELECT p.revision_id, 'pendingRevision'::text, p.artifact_id, NULL::uuid,
	       a.title,
	       COALESCE(CASE WHEN p.author_user_id = $13::uuid THEN c.name END, u.name),
	       p.seq, NULL::text, NULL::text, NULL::text, NULL::text,
	       p.created_at
	FROM "exagram"."pending_revisions"($13::uuid) p
	JOIN "exagram"."artifacts" a ON a.id = p.artifact_id
	JOIN "exagram"."users" u ON u.id = p.author_user_id
	LEFT JOIN "exagram"."connections" c ON c.id = p.author_connection_id
	WHERE (SELECT pending_revisions FROM pref)
	  AND p.is_approver
	  AND NOT (p.author_user_id = $13::uuid AND p.author_connection_id IS NULL)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND p.created_at >= $14::timestamptz

	UNION ALL

	SELECT g.id, 'grant'::text, a.id, NULL::uuid,
	       a.title,
	       CASE
	         WHEN g.created_by = a.owner_id
	           OR EXISTS (SELECT 1
	                        FROM "exagram"."grants" sg
	                       WHERE sg.artifact_id = a.id
	                         AND sg.grantee_id = g.created_by AND NOT sg.dormant)
	         THEN u.name
	       END,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       COALESCE(g.woken_at, g.created_at)
	FROM "exagram"."grants" g
	JOIN visible v ON v.artifact_id = g.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = g.artifact_id
	JOIN "exagram"."users" u ON u.id = g.created_by
	WHERE (SELECT grants FROM pref)
	  AND g.grantee_id = $13::uuid AND NOT g.dormant
	  AND g.created_by <> $13::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  -- The decision is sent under the same conditions as this row (visible, not muted) plus its own switch.
	  AND NOT ((SELECT decisions FROM pref)
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."access_requests" ar
	                        WHERE ar.artifact_id = g.artifact_id
	                          AND ar.requester_id = $13::uuid
	                          AND ar.resolution = 'granted'
	                          AND ar.resolved_at = g.created_at))
	  AND COALESCE(g.woken_at, g.created_at) >= $14::timestamptz

	UNION ALL

	SELECT g.id, 'grant'::text, NULL::uuid, p.id,
	       p.name,
	       CASE
	         WHEN g.created_by = p.owner_id THEN u.name
	         WHEN (p.owner_id = $13::uuid
	               OR EXISTS (SELECT 1
	                            FROM "exagram"."grants" mine
	                           WHERE mine.grantee_id = $13::uuid AND NOT mine.dormant
	                             AND mine.project_id IN (p.id, p.parent_project_id)
	                             AND mine.role IN ('edit', 'collaborate')))
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."grants" mg
	                        WHERE mg.project_id IN (p.id, p.parent_project_id)
	                          AND mg.grantee_id = g.created_by AND NOT mg.dormant
	                          AND mg.grantee_id <> p.owner_id)
	         THEN u.name
	       END,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       COALESCE(g.woken_at, g.created_at)
	FROM "exagram"."grants" g
	JOIN "exagram"."projects" p ON p.id = g.project_id
	JOIN "exagram"."users" u ON u.id = g.created_by
	WHERE (SELECT grants FROM pref)
	  AND g.grantee_id = $13::uuid AND NOT g.dormant
	  AND g.created_by <> $13::uuid
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = p.id)
	  AND COALESCE(g.woken_at, g.created_at) >= $14::timestamptz

	UNION ALL

	SELECT c.id, 'comment'::text, a.id, NULL::uuid,
	       a.title, u.name,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       c.created_at
	FROM visible v
	JOIN "exagram"."comments" c ON c.revision_id = v.revision_id
	JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
	JOIN "exagram"."users" u ON u.id = c.author_id
	WHERE (SELECT comments FROM pref)
	  AND c.author_id <> $13::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND c.created_at >= $14::timestamptz

	UNION ALL

	SELECT r.id, 'decision'::text, a.id, NULL::uuid,
	       a.title, o.name,
	       NULL::int, g.role, 'granted'::text, 'accessRequest'::text, NULL::text,
	       r.resolved_at
	FROM "exagram"."access_requests" r
	JOIN visible v ON v.artifact_id = r.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
	JOIN "exagram"."users" o ON o.id = a.owner_id
	JOIN "exagram"."grants" g ON g.artifact_id = a.id AND g.grantee_id = $13::uuid AND NOT g.dormant
	WHERE (SELECT decisions FROM pref)
	  AND r.requester_id = $13::uuid
	  AND r.resolution = 'granted'
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND r.resolved_at >= $14::timestamptz

	UNION ALL

	SELECT r.id, 'decision'::text, r.artifact_id, NULL::uuid,
	       ''::text, NULL::text,
	       NULL::int, NULL::text, 'declined'::text, 'accessRequest'::text, NULL::text,
	       r.resolved_at
	FROM "exagram"."access_requests" r
	WHERE (SELECT decisions FROM pref)
	  AND r.requester_id = $13::uuid
	  AND r.resolution = 'dismissed'
	  AND r.resolved_at >= $14::timestamptz

	UNION ALL

	SELECT rv.id, 'decision'::text, a.id, NULL::uuid,
	       a.title,
	       -- The approver is the Artifact's Owner, or the Owner of its folder, whom the author sees in the
	       -- folder list when they reach the folder.
	       CASE
	         WHEN o.id = a.owner_id THEN o.name
	         WHEN a.project_id IS NOT NULL
	           AND "exagram".user_project_role($13::uuid, a.project_id) IS NOT NULL
	         THEN o.name
	       END,
	       rv.seq, NULL::text,
	       CASE WHEN rv.status = 'approved' THEN 'approved' ELSE 'discarded' END,
	       'revision'::text, NULL::text,
	       COALESCE(rv.discarded_at, rv.approved_at)
	FROM "exagram"."revisions" rv
	JOIN "exagram"."artifacts" a ON a.id = rv.artifact_id
	JOIN "exagram"."users" o ON o.id = "exagram".artifact_owner(a.id)
	WHERE (SELECT decisions FROM pref)
	  AND rv.author_user_id = $13::uuid
	  AND ((rv.status = 'approved' AND rv.approved_at > rv.created_at AND rv.approved_at >= $14::timestamptz)
	       OR (rv.status = 'discarded' AND rv.discarded_at >= $14::timestamptz))
	  AND a.deleted_at IS NULL
	  AND o.id <> $13::uuid
	  AND "exagram".reaches_artifact($13::uuid, a.id)
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)

	UNION ALL

	SELECT rv.id, 'published'::text, a.id, NULL::uuid,
	       a.title,
	       CASE
	         WHEN rv.author_user_id = a.owner_id THEN u.name
	         WHEN EXISTS (SELECT 1
	                        FROM "exagram"."grants" sg
	                       WHERE sg.artifact_id = a.id
	                         AND sg.grantee_id = rv.author_user_id AND NOT sg.dormant
	                         AND sg.role IN ('edit', 'collaborate'))
	         THEN u.name
	         WHEN fp.id IS NOT NULL
	           AND (fp.owner_id = $13::uuid
	                OR EXISTS (SELECT 1
	                             FROM "exagram"."grants" mine
	                            WHERE mine.grantee_id = $13::uuid AND NOT mine.dormant
	                              AND mine.project_id IN (fp.id, fp.parent_project_id)
	                              AND mine.role IN ('edit', 'collaborate')))
	           AND EXISTS (SELECT 1
	                         FROM "exagram"."grants" mg
	                        WHERE mg.project_id IN (fp.id, fp.parent_project_id)
	                          AND mg.grantee_id = rv.author_user_id AND NOT mg.dormant
	                          AND mg.role IN ('edit', 'collaborate'))
	         THEN u.name
	       END,
	       rv.seq, NULL::text, NULL::text, NULL::text, NULL::text,
	       rv.approved_at
	FROM visible v
	JOIN "exagram"."revisions" rv ON rv.artifact_id = v.artifact_id
	JOIN "exagram"."artifacts" a ON a.id = v.artifact_id
	JOIN "exagram"."users" u ON u.id = rv.author_user_id
	LEFT JOIN "exagram"."projects" fp ON fp.id = a.project_id
	WHERE (SELECT published FROM pref)
	  AND (SELECT revision_scope FROM pref) <> 'mine'
	  AND NOT v.pinned
	  AND rv.status = 'approved'
	  AND rv.author_user_id <> $13::uuid
	  AND a.deleted_at IS NULL
	  AND NOT EXISTS (SELECT 1 FROM muted WHERE muted.id = a.project_id)
	  AND ((SELECT revision_scope FROM pref) = 'all'
	       OR EXISTS (SELECT 1
	                    FROM "exagram"."grants" dg
	                   WHERE dg.artifact_id = a.id
	                     AND dg.grantee_id = $13::uuid AND NOT dg.dormant)
	       OR (fp.id IS NOT NULL
	           AND ("exagram".user_project_role($13::uuid, fp.id) IS NOT NULL
	                OR "exagram".user_project_role($13::uuid, fp.parent_project_id) IS NOT NULL)))
	  AND rv.approved_at >= $14::timestamptz

	UNION ALL

	SELECT c.id, 'connection'::text, NULL::uuid, NULL::uuid,
	       c.name, NULL::text,
	       NULL::int, NULL::text, NULL::text, NULL::text, NULL::text,
	       GREATEST(c.created_at, c.scopes_widened_at)
	FROM "exagram"."connections" c
	WHERE (SELECT connections FROM pref)
	  AND c.user_id = $13::uuid
	  AND c.revoked_at IS NULL
	  AND GREATEST(c.created_at, c.scopes_widened_at) >= $14::timestamptz
)
SELECT items.id, items.kind, items.artifact_id, items.project_id, items.title, items.actor_name, items.revision,
       items.role, items.outcome, items.subject, items.note, items.created_at,
       to_char(items.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
       item.workspace_id::uuid AS workspace_id
FROM items
CROSS JOIN LATERAL (
	SELECT COALESCE(
	        (SELECT a.workspace_id FROM "exagram"."artifacts" a WHERE a.id = items.artifact_id),
	        (SELECT p.workspace_id FROM "exagram"."projects" p WHERE p.id = items.project_id),
	        (SELECT c.workspace_id FROM "exagram"."connections" c WHERE c.id = items.id AND items.kind = 'connection')
	       ) AS workspace_id
) item
WHERE COALESCE((
        SELECT w.notification_email_enabled
           AND (w.notification_email_resumed_at IS NULL OR items.created_at >= w.notification_email_resumed_at)
        FROM "exagram"."workspaces" w WHERE w.id = item.workspace_id
      ), false)
  AND ($1::uuid IS NULL
       OR (items.created_at, items.id) > ($2::text::timestamptz, $1::uuid))
  AND ($3::timestamptz IS NULL OR items.created_at <= $3::timestamptz)
ORDER BY items.created_at ASC, items.id ASC
LIMIT $4::int`,
	getPasswordResetPreviewByTokenHash: `-- name: GetPasswordResetPreviewByTokenHash :one
SELECT u.email::text AS email, w.name AS workspace_name
FROM "exagram"."password_resets" r
JOIN "exagram"."users" u ON u.id = r.user_id
JOIN "exagram"."workspaces" w ON w.id = COALESCE(r.workspace_id, u.workspace_id)
WHERE r.token_hash = $1::text AND r.expires_at > now()`,
	listVisibleProjects: `-- name: ListVisibleProjects :many
SELECT p.id, p.workspace_id, p.owner_id, p.parent_project_id, p.name, p.created_at, p.redaction, p.publish_policy,
       p.link_preview, p.description AS source_description,
       owner.name AS owner_name,
       (CASE
          WHEN "exagram".live_member($1, p.workspace_id)
           AND (p.owner_id = $1
            OR EXISTS (SELECT 1
                         FROM "exagram"."grants" mine
                        WHERE mine.grantee_id = $1 AND NOT mine.dormant
                          AND mine.project_id IN (p.id, p.parent_project_id)
                          AND mine.role IN ('edit', 'collaborate')))
          THEN coalesce((SELECT array_agg(m.name ORDER BY m.name)
                           FROM (SELECT u.id,
                                        CASE WHEN bool_or(g.dormant) OR "exagram".grantee_pending(u.id, p.workspace_id)
                                             THEN lower(u.email::text) ELSE u.name END AS name
                                   FROM "exagram"."grants" g
                                   JOIN "exagram"."users" u ON u.id = g.grantee_id
                                  WHERE g.project_id IN (p.id, p.parent_project_id)
                                    AND g.grantee_id <> p.owner_id
                                  GROUP BY u.id) m), '{}')
        END)::text[] AS member_names
FROM "exagram"."projects" p
JOIN "exagram"."users" owner ON owner.id = p.owner_id
WHERE "exagram".principal_scope_covers('user', $1, $2::uuid, p.workspace_id)
  AND (p.workspace_id = $2::uuid OR p.owner_id <> $1)
  AND (p.owner_id = $1
       OR p.id IN (SELECT g.project_id FROM "exagram"."grants" g WHERE g.grantee_id = $1 AND NOT g.dormant)
       OR p.parent_project_id IN (
         SELECT g.project_id FROM "exagram"."grants" g WHERE g.grantee_id = $1 AND NOT g.dormant))
ORDER BY coalesce(p.parent_project_id::text, p.id::text), p.parent_project_id NULLS FIRST, p.name`,
} as const
