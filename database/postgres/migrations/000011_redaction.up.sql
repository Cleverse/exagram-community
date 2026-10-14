BEGIN;

ALTER TABLE "exagram"."revisions"
	ADD COLUMN "redacted_text" TEXT,
	ADD COLUMN "redaction_status" TEXT NOT NULL DEFAULT 'none'
		CHECK ("redaction_status" IN ('none','queued','done','failed','too_large')),
	ADD COLUMN "redaction_detector_version" INTEGER,
	-- sha256 of the exact string the detector ran on, so a later parse that changes that input is
	-- detectable rather than silently leaving stale Redacted Text behind.
	ADD COLUMN "redaction_input_sha256" TEXT,
	ADD COLUMN "redaction_error" TEXT,
	ADD COLUMN "redaction_attempts" INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN "redaction_queued_at" TIMESTAMPTZ,
	ADD COLUMN "placeholder_types" TEXT[] NOT NULL DEFAULT '{}';

-- Mirrors 000008's search_tsv, over the Redacted Text: a Connection's search must never rank or
-- snippet over the original, or search becomes an oracle for the values redaction removed.
ALTER TABLE "exagram"."revisions"
	ADD COLUMN "redacted_tsv" tsvector
		GENERATED ALWAYS AS (to_tsvector('simple', left(coalesce("redacted_text", ''), 900000))) STORED;

CREATE INDEX "revisions_redacted_tsv_idx" ON "exagram"."revisions" USING GIN ("redacted_tsv");
CREATE INDEX "revisions_redaction_sweep_idx"
	ON "exagram"."revisions" ("redaction_status", "redaction_detector_version");

ALTER TABLE "exagram"."projects"
	ADD COLUMN "redaction" TEXT CHECK ("redaction" IN ('on','off'));

ALTER TABLE "exagram"."artifacts"
	ADD COLUMN "redaction" TEXT CHECK ("redaction" IN ('on','off'));

ALTER TABLE "exagram"."ledger_serves"
	ADD COLUMN "form" TEXT CHECK ("form" IN ('original','redacted')),
	ADD COLUMN "detector_version" INTEGER;

-- NULL means inherit. A sub-Project is at most one level deep (the projects_depth_check trigger in
-- 000002), so the chain Artifact → Project → parent Project → 'on' is the whole resolution.
CREATE FUNCTION "exagram".effective_redaction(p_artifact_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
	SELECT coalesce(a.redaction, p.redaction, pp.redaction, 'on') = 'on'
	FROM "exagram"."artifacts" a
	LEFT JOIN "exagram"."projects" p ON p.id = a.project_id
	LEFT JOIN "exagram"."projects" pp ON pp.id = p.parent_project_id
	WHERE a.id = p_artifact_id;
$$;

-- Replacing rather than overloading: CREATE OR REPLACE with an extra argument would leave the old
-- two-argument function callable, and that call would skip the guard below.
DROP FUNCTION "exagram".approve_revision(uuid, uuid);

CREATE FUNCTION "exagram".approve_revision(
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
