BEGIN;

-- ADR 0022, amended: under 'auto', a Revision a Connection writes publishes on arrival the same way
-- its person's own upload does. Same signature as 000018, so every caller keeps working. What
-- changes is who may author the Revision. It may be the person, or a live Connection of theirs
-- that can still write the Artifact inside its folder scope (ADR 0024). The person must still be
-- the Owner or an Editor, so a Collaborator's Connection waits exactly as the Collaborator does.
--
-- The placeholder guard lives with the caller: a Connection's body is not in the database when it
-- lands, so McpToolsUsecase runs findPlaceholderTypes over it and never calls this for a body that
-- carries a placeholder. That Revision stays Pending and keeps ADR 0019's confirmation step.
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
     SET status = 'approved', approved_at = now()
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
