-- name: GetAnyonePasswordHash :one
-- The hash an unlock checks, only while the Artifact is open to Anyone with the link, behind a password, unexpired,
-- live and has a Current Revision. No row otherwise, so a caller cannot tell the reasons apart.
SELECT a.anyone_password_hash::text AS password_hash
FROM "exagram"."artifacts" a
WHERE a.id = @artifact_id::uuid
  AND a.general_access = 'anyone'
  AND a.anyone_password_on
  AND (a.anyone_expires_at IS NULL OR a.anyone_expires_at > now())
  AND a.deleted_at IS NULL
  AND a.current_revision_id IS NOT NULL;

-- name: InsertAnyoneUnlock :one
-- Stores an Unlock only against the hash it was checked with, so none outlives the password it was earned
-- with. The share lock makes the insert wait for a password change in flight and then look at
-- the new hash; a change that arrives after it waits for the insert and deletes the row. No row comes back
-- when the hash no longer matches.
INSERT INTO "exagram"."anyone_unlocks" ("token_hash", "artifact_id", "expires_at")
SELECT @token_hash::text, a.id, @expires_at::timestamptz
FROM "exagram"."artifacts" a
WHERE a.id = @artifact_id::uuid
  AND a.anyone_password_on
  AND a.anyone_password_hash = @password_hash::text
FOR SHARE OF a
RETURNING "token_hash";

-- name: DeleteAnyoneUnlocks :exec
-- Replacing the password ends every browser's unlock of the Artifact.
DELETE FROM "exagram"."anyone_unlocks" WHERE "artifact_id" = @artifact_id::uuid;
