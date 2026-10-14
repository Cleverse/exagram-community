BEGIN;

-- Notifications answer requests and follow the member.

-- Three more kinds (on), the recap (off, scheduled on each device), which folders `published` follows,
-- and quiet hours. Quiet hours are kept here so every device shares them; each device evaluates them in
-- its own time zone.
ALTER TABLE "exagram"."notification_preferences"
	ADD COLUMN "decisions" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "connections" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "recap" BOOLEAN NOT NULL DEFAULT false,
	ADD COLUMN "revision_scope" TEXT NOT NULL DEFAULT 'member' CHECK ("revision_scope" IN ('all', 'member', 'mine')),
	ADD COLUMN "quiet_hours" BOOLEAN NOT NULL DEFAULT true,
	ADD COLUMN "quiet_from" TIME NOT NULL DEFAULT '22:00',
	ADD COLUMN "quiet_to" TIME NOT NULL DEFAULT '08:00',
	ADD COLUMN "quiet_urgent" BOOLEAN NOT NULL DEFAULT true;

-- Folders whose Artifacts, and their subfolders' Artifacts, send a member nothing but a declined access
-- decision. Only folders the member reaches are kept (UpsertNotificationPreferences).
CREATE TABLE "exagram"."notification_muted_projects" (
	"user_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"project_id" UUID NOT NULL REFERENCES "exagram"."projects"("id") ON DELETE CASCADE,
	PRIMARY KEY ("user_id", "project_id")
);

CREATE INDEX "notification_muted_projects_project_id_idx" ON "exagram"."notification_muted_projects" ("project_id");

-- The role a requester asks for. The Owner's grant defaults to it and may change it.
ALTER TABLE "exagram"."access_requests"
	ADD COLUMN "role" TEXT NOT NULL DEFAULT 'view' CHECK ("role" IN ('view', 'collaborate', 'edit'));

-- When a Pending Revision was discarded, so its author hears the answer.
ALTER TABLE "exagram"."revisions" ADD COLUMN "discarded_at" TIMESTAMPTZ;

-- When a re-consent last gave a Connection a scope it did not have.
ALTER TABLE "exagram"."connections" ADD COLUMN "scopes_widened_at" TIMESTAMPTZ;

-- `published` reads Revisions by when they were approved.
CREATE INDEX "revisions_approved_at_idx" ON "exagram"."revisions" ("approved_at") WHERE "approved_at" IS NOT NULL;

-- Same as 000023 except approved_at: a Revision published on arrival is stamped with its own created_at,
-- so `approved_at = created_at` tells it from one an approver answered later, even when the upload and
-- the publish run as separate statements. Revisions published on arrival before this migration keep
-- approved_at = now() of their publish, a moment after created_at, so for up to seven days after it is
-- applied their authors may see them as approved decisions. Nothing tells those rows apart; accepted.
CREATE OR REPLACE FUNCTION exagram.publish_on_upload(p_revision_id uuid, p_author_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_artifact_id uuid;
  v_seq         int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('exagram:approve:' || p_revision_id::text));

  SELECT r.artifact_id, r.seq
    INTO v_artifact_id, v_seq
    FROM exagram.revisions r
    JOIN exagram.artifacts a ON a.id = r.artifact_id
   WHERE r.id = p_revision_id
     AND r.status = 'pending'
     AND r.author_user_id = p_author_user_id
     AND (
       r.author_connection_id IS NULL
       OR EXISTS (
         SELECT 1 FROM exagram.connections c
          WHERE c.id = r.author_connection_id
            AND c.user_id = p_author_user_id
            AND c.revoked_at IS NULL
            AND exagram.connection_artifact_right(c.id, a.id) = 'edit'
       )
     )
     AND a.deleted_at IS NULL
     AND exagram.effective_publish_policy(a.id) = 'auto'
     AND (
       SELECT rr.access
         FROM exagram.reach_rows(p_author_user_id) rr
        WHERE rr.artifact_id = a.id
        ORDER BY rr.src_rank,
          CASE rr.access WHEN 'edit' THEN 0 WHEN 'collaborate' THEN 1 ELSE 2 END, rr.pinned DESC
        LIMIT 1
     ) IN ('owner', 'edit')
     FOR UPDATE OF r;

  IF v_artifact_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE exagram.revisions
     SET status = 'approved', approved_at = created_at
   WHERE id = p_revision_id;

  UPDATE exagram.artifacts a
     SET current_revision_id = p_revision_id
   WHERE a.id = v_artifact_id
     AND (
       a.current_revision_id IS NULL
       OR v_seq > (SELECT c.seq FROM exagram.revisions c WHERE c.id = a.current_revision_id)
     );

  RETURN p_revision_id;
END $$;

COMMIT;
