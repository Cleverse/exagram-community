BEGIN;

DROP FUNCTION IF EXISTS "exagram".approve_revision(uuid, uuid, boolean);

CREATE FUNCTION exagram.approve_revision(p_revision_id uuid, p_approver_user_id uuid)
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
     AND a.deleted_at IS NULL
     AND exagram.artifact_owner(a.id) = p_approver_user_id
     FOR UPDATE OF r;

  IF v_artifact_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE exagram.revisions
     SET status = 'approved', approved_at = now()
   WHERE id = p_revision_id;

  -- The Current Revision is the NEWEST approved one: approving an older pending revision
  -- makes it approved without dragging the pointer back.
  UPDATE exagram.artifacts a
     SET current_revision_id = p_revision_id
   WHERE a.id = v_artifact_id
     AND (
       a.current_revision_id IS NULL
       OR v_seq > (SELECT c.seq FROM exagram.revisions c WHERE c.id = a.current_revision_id)
     );

  RETURN p_revision_id;
END $$;

DROP FUNCTION IF EXISTS "exagram".effective_redaction(uuid);

ALTER TABLE "exagram"."ledger_serves"
	DROP COLUMN IF EXISTS "detector_version",
	DROP COLUMN IF EXISTS "form";

ALTER TABLE "exagram"."artifacts" DROP COLUMN IF EXISTS "redaction";
ALTER TABLE "exagram"."projects" DROP COLUMN IF EXISTS "redaction";

DROP INDEX IF EXISTS "exagram"."revisions_redaction_sweep_idx";
DROP INDEX IF EXISTS "exagram"."revisions_redacted_tsv_idx";

ALTER TABLE "exagram"."revisions"
	DROP COLUMN IF EXISTS "redacted_tsv",
	DROP COLUMN IF EXISTS "placeholder_types",
	DROP COLUMN IF EXISTS "redaction_queued_at",
	DROP COLUMN IF EXISTS "redaction_attempts",
	DROP COLUMN IF EXISTS "redaction_error",
	DROP COLUMN IF EXISTS "redaction_input_sha256",
	DROP COLUMN IF EXISTS "redaction_detector_version",
	DROP COLUMN IF EXISTS "redaction_status",
	DROP COLUMN IF EXISTS "redacted_text";

COMMIT;
