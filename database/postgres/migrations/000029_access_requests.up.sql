BEGIN;

-- Access Requests: a person who opens an Artifact's address and is refused may ask its Owner
-- for access. The request is only kept when the Artifact is live, sits in the requester's own Workspace
-- and the requester does not already reach it; the API answers the same way whether or not a row is
-- written, so the refusal screen still says nothing. At most one open request per person and Artifact.
CREATE TABLE "exagram"."access_requests" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id"),
	"artifact_id" UUID NOT NULL REFERENCES "exagram"."artifacts"("id") ON DELETE CASCADE,
	"requester_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"note" TEXT CHECK (char_length("note") <= 500),
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"resolved_at" TIMESTAMPTZ,
	"resolution" TEXT CHECK ("resolution" IN ('granted', 'dismissed')),
	CHECK (("resolved_at" IS NULL) = ("resolution" IS NULL))
);

CREATE UNIQUE INDEX "access_requests_open_idx"
	ON "exagram"."access_requests" ("artifact_id", "requester_id")
	WHERE "resolved_at" IS NULL;

CREATE INDEX "access_requests_requester_id_idx" ON "exagram"."access_requests" ("requester_id");

-- A request opened or closed goes to the Artifact's Owner only: the requester does not reach the
-- Artifact, so nothing is sent to them.
CREATE FUNCTION "exagram".access_requests_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_row "exagram"."access_requests"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  PERFORM "exagram".notify_change(a.workspace_id, a.id, a.project_id, 'accessRequests', ARRAY[a.owner_id])
     FROM "exagram"."artifacts" a
    WHERE a.id = v_row.artifact_id;
  RETURN NULL;
END $$;

CREATE TRIGGER "access_requests_notify"
	AFTER INSERT OR UPDATE OR DELETE ON "exagram"."access_requests"
	FOR EACH ROW EXECUTE FUNCTION "exagram".access_requests_notify();

COMMIT;
