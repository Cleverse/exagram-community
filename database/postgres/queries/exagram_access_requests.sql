-- name: OpenAccessRequest :exec
-- Keeps the request only when the Artifact is live, sits in the requester's Workspace and the
-- requester neither reaches it already nor reads it through General Access, and when its Owner has
-- not dismissed one from this requester in the last week. Writes nothing otherwise; the caller answers
-- the same either way. Asking again while a request is open refreshes its note, role and time.
INSERT INTO "exagram"."access_requests" ("workspace_id", "artifact_id", "requester_id", "note", "role")
SELECT a.workspace_id, a.id, u.id, sqlc.narg('note')::text, @role::text
FROM "exagram"."artifacts" a
JOIN "exagram"."users" u ON u.id = @requester_id::uuid AND "exagram".live_member(u.id, a.workspace_id)
WHERE a.id = @artifact_id::uuid
  AND a.deleted_at IS NULL
  AND a.owner_id <> u.id
  AND NOT "exagram".reaches_artifact(u.id, a.id)
  AND NOT EXISTS (SELECT 1 FROM "exagram"."visible_artifact"('user', u.id, a.id))
  AND NOT EXISTS (
    SELECT 1
    FROM "exagram"."access_requests" d
    WHERE d.artifact_id = a.id
      AND d.requester_id = u.id
      AND d.resolution = 'dismissed'
      AND d.resolved_at > now() - interval '7 days'
  )
ON CONFLICT ("artifact_id", "requester_id") WHERE "resolved_at" IS NULL
DO UPDATE SET "note" = EXCLUDED."note", "role" = EXCLUDED."role", "created_at" = now();

-- name: CancelAccessRequest :exec
-- Deletes the requester's own open request on the Artifact, if there is one. The caller answers the same
-- whether a row went.
DELETE FROM "exagram"."access_requests"
WHERE "artifact_id" = @artifact_id::uuid
  AND "requester_id" = @requester_id::uuid
  AND "resolved_at" IS NULL;

-- name: ListOpenAccessRequestsForOwner :many
-- Open requests on the Owner's live Artifacts, newest first. A requester who has come to reach the
-- Artifact some other way, or was Removed, drops out.
SELECT r.id, r.artifact_id, a.title AS artifact_title, r.requester_id, u.email::text AS requester_email,
       u.name AS requester_name, r.note, r.role, r.created_at
FROM "exagram"."access_requests" r
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
JOIN "exagram"."users" u ON u.id = r.requester_id
WHERE a.owner_id = @owner_id::uuid
  AND a.workspace_id = @workspace_id::uuid
  AND a.deleted_at IS NULL
  AND r.resolved_at IS NULL
  AND "exagram".live_member(u.id, a.workspace_id)
  AND NOT "exagram".reaches_artifact(u.id, a.id)
ORDER BY r.created_at DESC
LIMIT 200;

-- name: GetOpenAccessRequestForOwner :one
-- One open request, only for the Owner of its Artifact; locked so a grant and a dismiss cannot both win.
SELECT r.id, r.artifact_id, r.requester_id, u.email::text AS requester_email
FROM "exagram"."access_requests" r
JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
JOIN "exagram"."users" u ON u.id = r.requester_id
WHERE r.id = @id::uuid
  AND a.owner_id = @owner_id::uuid
  AND a.deleted_at IS NULL
  AND r.resolved_at IS NULL
FOR UPDATE OF r;

-- name: ResolveAccessRequest :one
UPDATE "exagram"."access_requests"
SET "resolved_at" = now(), "resolution" = @resolution::text
WHERE "id" = @id::uuid AND "resolved_at" IS NULL
RETURNING "id";
