BEGIN;

SET LOCAL lock_timeout = '5s';

-- The Owner of an Artifact open to Anyone with the link may require a password, expire the
-- address and withhold download. The hash is argon2id; the password itself is never stored.
ALTER TABLE "exagram"."artifacts"
	ADD COLUMN "anyone_password_hash" TEXT,
	ADD COLUMN "anyone_password_on" BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN "anyone_expires_at" TIMESTAMPTZ,
	ADD COLUMN "anyone_download" BOOLEAN NOT NULL DEFAULT true,
	ADD CONSTRAINT "artifacts_anyone_password_check"
		CHECK (NOT "anyone_password_on" OR "anyone_password_hash" IS NOT NULL) NOT VALID;

-- Validated apart from the ADD, so the scan does not hold the ACCESS EXCLUSIVE lock.
ALTER TABLE "exagram"."artifacts" VALIDATE CONSTRAINT "artifacts_anyone_password_check";

-- The Owner's other sessions refresh their Share dialog when the settings change.
DROP TRIGGER "artifacts_notify_artifact" ON "exagram"."artifacts";
CREATE TRIGGER "artifacts_notify_artifact"
	AFTER UPDATE ON "exagram"."artifacts"
	FOR EACH ROW
	WHEN (
		OLD.title IS DISTINCT FROM NEW.title
		OR OLD.description IS DISTINCT FROM NEW.description
		OR OLD.project_id IS DISTINCT FROM NEW.project_id
		OR OLD.publish_policy IS DISTINCT FROM NEW.publish_policy
		OR OLD.redaction IS DISTINCT FROM NEW.redaction
		OR OLD.general_access IS DISTINCT FROM NEW.general_access
		OR OLD.anyone_password_on IS DISTINCT FROM NEW.anyone_password_on
		OR OLD.anyone_password_hash IS DISTINCT FROM NEW.anyone_password_hash
		OR OLD.anyone_expires_at IS DISTINCT FROM NEW.anyone_expires_at
		OR OLD.anyone_download IS DISTINCT FROM NEW.anyone_download
		OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
	)
	EXECUTE FUNCTION "exagram".artifacts_notify('artifact');

-- A browser's proof that it entered the password: the sha256 of the cookie's value, never the value.
-- Replacing the password deletes the Artifact's rows, so the old password's unlocks stop at once.
CREATE TABLE "exagram"."anyone_unlocks" (
	"token_hash" TEXT PRIMARY KEY,
	"artifact_id" UUID NOT NULL REFERENCES "exagram"."artifacts"("id") ON DELETE CASCADE,
	"expires_at" TIMESTAMPTZ NOT NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "anyone_unlocks_artifact_idx" ON "exagram"."anyone_unlocks" ("artifact_id");

-- The return type gains `download`, which CREATE OR REPLACE cannot change. commentable_artifact reads
-- visible_artifact, so it goes first and comes back last.
DROP FUNCTION "exagram".commentable_artifact(TEXT, UUID, UUID);
DROP FUNCTION "exagram".visible_artifact(TEXT, UUID, UUID);

-- 000038's rules, plus on the 'anyone' tier: an expired address admits nobody, and a password
-- admits only a reader whose browser holds a live unlock (`p_unlock`, the sha256 of its cookie). The
-- Owner and every Grant row come from visible_artifacts, ahead of this tier, so they meet neither.
-- `download` is false only for a reader this tier admits when the Owner withheld download.
CREATE FUNCTION "exagram".visible_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID, p_unlock TEXT DEFAULT NULL)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN, org_only BOOLEAN, download BOOLEAN)
LANGUAGE sql STABLE AS $$
	SELECT v.artifact_id, v.revision_id, v.access, v.pinned, false, true
	FROM "exagram".visible_artifacts(p_kind, p_id) v
	WHERE v.artifact_id = p_artifact_id
	UNION ALL
	SELECT a.id, a.current_revision_id, 'view'::TEXT, false, true,
		CASE WHEN a.general_access = 'anyone' THEN a.anyone_download ELSE true END
	FROM "exagram"."artifacts" a
	WHERE a.id = p_artifact_id
	  AND a.deleted_at IS NULL
	  AND a.current_revision_id IS NOT NULL
	  AND (
		(a.general_access = 'anyone'
			AND (a.anyone_expires_at IS NULL OR a.anyone_expires_at > now())
			AND (
				NOT a.anyone_password_on
				OR EXISTS (
					SELECT 1 FROM "exagram"."anyone_unlocks" k
					WHERE k.token_hash = p_unlock AND k.artifact_id = a.id AND k.expires_at > now()
				)
			)
			AND (
				(p_kind = 'anonymous' AND p_id = p_artifact_id)
				OR (p_kind = 'user' AND EXISTS (SELECT 1 FROM "exagram"."users" u WHERE u.id = p_id))
			))
		OR (a.general_access = 'org' AND p_kind = 'user' AND "exagram".live_member(p_id, a.workspace_id) AND EXISTS (
			SELECT 1
			FROM "exagram"."workspace_org_domains" d
			JOIN "exagram"."user_identities" i ON i.user_id = p_id AND i.provider = 'google'
			WHERE d.workspace_id = a.workspace_id
			  AND right(i.email::TEXT, length(d.domain::TEXT) + 1)::public.CITEXT = ('@' || d.domain::TEXT)::public.CITEXT
		))
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM "exagram".visible_artifacts(p_kind, p_id) v
		WHERE v.artifact_id = p_artifact_id
	  )
$$;

CREATE FUNCTION "exagram".commentable_artifact(p_kind TEXT, p_id UUID, p_artifact_id UUID, p_unlock TEXT DEFAULT NULL)
RETURNS TABLE (artifact_id UUID, revision_id UUID, access TEXT, pinned BOOLEAN, org_only BOOLEAN, download BOOLEAN)
LANGUAGE sql STABLE AS $$
	SELECT v.artifact_id, v.revision_id, v.access, v.pinned, v.org_only, v.download
	FROM "exagram".visible_artifact(p_kind, p_id, p_artifact_id, p_unlock) v
	WHERE NOT v.org_only
	   OR (p_kind = 'user' AND EXISTS (
		SELECT 1 FROM "exagram"."artifacts" a
		WHERE a.id = v.artifact_id AND "exagram".live_member(p_id, a.workspace_id)
	   ))
$$;

-- Why a read that visible_artifact refused met a gate and not a plain refusal: 'expired' or 'password'.
-- NULL means no gate, and the caller refuses as it does a missing Artifact. It matches the same readers
-- and Artifacts as the 'anyone' tier above, so it says nothing about a restricted, deleted or empty one.
-- A reader holding a live unlock does not meet the password gate; the Comments boundary can refuse one.
CREATE FUNCTION "exagram".anyone_gate(p_kind TEXT, p_id UUID, p_artifact_id UUID, p_unlock TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql STABLE AS $$
	SELECT CASE
		WHEN a.anyone_expires_at IS NOT NULL AND a.anyone_expires_at <= now() THEN 'expired'
		WHEN a.anyone_password_on AND NOT EXISTS (
			SELECT 1 FROM "exagram"."anyone_unlocks" k
			WHERE k.token_hash = p_unlock AND k.artifact_id = a.id AND k.expires_at > now()
		) THEN 'password'
	END
	FROM "exagram"."artifacts" a
	WHERE a.id = p_artifact_id
	  AND a.general_access = 'anyone'
	  AND a.deleted_at IS NULL
	  AND a.current_revision_id IS NOT NULL
	  AND (
		(p_kind = 'anonymous' AND p_id = p_artifact_id)
		OR (p_kind = 'user' AND EXISTS (SELECT 1 FROM "exagram"."users" u WHERE u.id = p_id))
	  )
$$;

COMMIT;
