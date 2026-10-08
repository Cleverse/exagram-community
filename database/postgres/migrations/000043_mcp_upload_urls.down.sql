BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS "exagram"."mcp_pending_uploads";

CREATE OR REPLACE FUNCTION "exagram".approve_revision(
	p_revision_id uuid,
	p_approver_user_id uuid,
	p_confirm_placeholders boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_artifact_id      uuid;
  v_seq              int;
  v_by_connection    boolean;
  v_placeholders     text[];
  v_redaction_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('exagram:approve:' || p_revision_id::text));

  SELECT r.artifact_id, r.seq, r.author_connection_id IS NOT NULL, r.placeholder_types, r.redaction_status
    INTO v_artifact_id, v_seq, v_by_connection, v_placeholders, v_redaction_status
    FROM exagram.revisions r
    JOIN exagram.artifacts a ON a.id = r.artifact_id
   WHERE r.id = p_revision_id
     AND r.status = 'pending'
     AND a.deleted_at IS NULL
     AND exagram.artifact_owner(a.id) = p_approver_user_id
     FOR UPDATE OF r;

  -- Before the guards: a non-Approver must still get the indistinguishable NULL, never an error
  -- that tells them the revision exists.
  IF v_artifact_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Approving before the redaction job has run would pass a revision whose placeholder_types is
  -- still the default empty array, which is exactly the guard being skipped.
  IF v_by_connection AND v_redaction_status <> 'done' THEN
    RAISE EXCEPTION 'redaction is not ready for revision %', p_revision_id
      USING ERRCODE = 'EXR01';
  END IF;

  IF v_by_connection AND cardinality(v_placeholders) > 0 AND p_confirm_placeholders IS NOT TRUE THEN
    RAISE EXCEPTION 'revision % carries placeholders and needs confirmation', p_revision_id
      USING ERRCODE = 'EXR02';
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

COMMIT;
