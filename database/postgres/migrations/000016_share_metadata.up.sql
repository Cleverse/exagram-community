BEGIN;

ALTER TABLE "exagram"."workspaces"
	ADD COLUMN "restricted_shares" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "exagram"."share_allowed_emails" (
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id") ON DELETE CASCADE,
	"email" TEXT NOT NULL,
	"kind" TEXT NOT NULL,
	"can_create" BOOLEAN NOT NULL,
	"note" TEXT,
	"source_created_at" TIMESTAMPTZ NOT NULL,
	PRIMARY KEY ("workspace_id", "email"),
	CHECK ("email" = lower("email"))
);

ALTER TABLE "exagram"."projects"
	ADD COLUMN "description" TEXT;

ALTER TABLE "exagram"."artifacts"
	ADD COLUMN "filename" TEXT,
	ADD COLUMN "description" TEXT,
	ADD COLUMN "source_updated_at" TIMESTAMPTZ;

ALTER TABLE "exagram"."revisions"
	ADD COLUMN "source_parent_revision_id" UUID,
	ADD COLUMN "source_restored_from" UUID,
	ADD COLUMN "source_snippet" TEXT,
	ADD COLUMN "source_origin" TEXT,
	ADD COLUMN "source_client_id" UUID,
	ADD COLUMN "source_storage_path" TEXT;

ALTER TABLE "exagram"."grants"
	ADD COLUMN "shared_with_email" TEXT,
	ADD COLUMN "source_shared_with_email" TEXT,
	ADD COLUMN "source_role" TEXT;

CREATE FUNCTION "exagram".check_share_target() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
	target_workspace UUID;
	target_email TEXT;
	grantee_workspace UUID;
BEGIN
	IF NEW.artifact_id IS NOT NULL THEN
		SELECT workspace_id INTO target_workspace FROM "exagram"."artifacts" WHERE id = NEW.artifact_id;
	ELSE
		SELECT workspace_id INTO target_workspace FROM "exagram"."projects" WHERE id = NEW.project_id;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM "exagram"."workspaces"
		WHERE id = target_workspace AND restricted_shares
	) THEN
		RETURN NEW;
	END IF;
	SELECT lower(btrim(email::TEXT)), workspace_id INTO target_email, grantee_workspace
		FROM "exagram"."users" WHERE id = NEW.grantee_id;
	IF target_email IS NULL OR grantee_workspace IS DISTINCT FROM target_workspace OR (
		NEW.shared_with_email IS NOT NULL AND lower(btrim(NEW.shared_with_email)) <> target_email
	) THEN
		RAISE EXCEPTION 'Restricted Shares grant email does not match grantee identity'
			USING ERRCODE = '23514';
	END IF;
	IF NOT (
		EXISTS (
			SELECT 1 FROM "exagram"."share_allowed_emails"
			WHERE workspace_id = target_workspace AND email = target_email
		)
	) THEN
		RAISE EXCEPTION 'Restricted Shares grantee email is outside the allowlist'
			USING ERRCODE = '23514';
	END IF;
	NEW.shared_with_email := target_email;
	RETURN NEW;
END;
$$;

CREATE TRIGGER "check_share_target"
	BEFORE INSERT OR UPDATE OF artifact_id, project_id, grantee_id, shared_with_email ON "exagram"."grants"
	FOR EACH ROW EXECUTE FUNCTION "exagram".check_share_target();

ALTER TABLE "exagram"."comments"
	ADD COLUMN "source_artifact_id" UUID,
	ADD COLUMN "source_parent_id" UUID,
	ADD COLUMN "source_revision_id" UUID,
	ADD COLUMN "source_anchor" JSONB,
	ADD COLUMN "source_resolved_at" TIMESTAMPTZ,
	ADD COLUMN "source_resolved_by" UUID,
	ADD COLUMN "source_updated_at" TIMESTAMPTZ;

CREATE TABLE "exagram"."revision_text" (
	"revision_id" UUID PRIMARY KEY REFERENCES "exagram"."revisions"("id") ON DELETE CASCADE,
	"text_content" TEXT,
	"created_at" TIMESTAMPTZ,
	"updated_at" TIMESTAMPTZ
);

CREATE TABLE "exagram"."revision_ai_metadata" (
	"revision_id" UUID PRIMARY KEY REFERENCES "exagram"."revisions"("id") ON DELETE CASCADE,
	"model" TEXT,
	"instruction" TEXT,
	"scoped" BOOLEAN,
	"created_at" TIMESTAMPTZ
);

CREATE TABLE "exagram"."revision_previews" (
	"revision_id" UUID PRIMARY KEY REFERENCES "exagram"."revisions"("id") ON DELETE CASCADE,
	"html" TEXT,
	"converter" TEXT,
	"failed_reason" TEXT,
	"created_at" TIMESTAMPTZ
);

COMMIT;
