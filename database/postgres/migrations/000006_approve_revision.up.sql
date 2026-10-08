-- database/postgres/migrations/000006_approve_revision.up.sql
-- The Owner is the Approver (ADR 0013), and `exagram.artifact_owner` from 000005 is the only
-- definition of who that is. This is the only writer of artifacts.current_revision_id.
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
