BEGIN;

DROP TABLE "exagram"."revision_previews";
DROP TABLE "exagram"."revision_ai_metadata";
DROP TABLE "exagram"."revision_text";

DROP TRIGGER "check_share_target" ON "exagram"."grants";
DROP FUNCTION "exagram".check_share_target();

ALTER TABLE "exagram"."comments"
	DROP COLUMN "source_updated_at",
	DROP COLUMN "source_resolved_by",
	DROP COLUMN "source_resolved_at",
	DROP COLUMN "source_anchor",
	DROP COLUMN "source_revision_id",
	DROP COLUMN "source_parent_id",
	DROP COLUMN "source_artifact_id";

ALTER TABLE "exagram"."grants"
	DROP COLUMN "source_role",
	DROP COLUMN "source_shared_with_email",
	DROP COLUMN "shared_with_email";

ALTER TABLE "exagram"."revisions"
	DROP COLUMN "source_storage_path",
	DROP COLUMN "source_client_id",
	DROP COLUMN "source_origin",
	DROP COLUMN "source_snippet",
	DROP COLUMN "source_restored_from",
	DROP COLUMN "source_parent_revision_id";

ALTER TABLE "exagram"."artifacts"
	DROP COLUMN "source_updated_at",
	DROP COLUMN "description",
	DROP COLUMN "filename";

ALTER TABLE "exagram"."projects"
	DROP COLUMN "description";

DROP TABLE "exagram"."share_allowed_emails";
ALTER TABLE "exagram"."workspaces" DROP COLUMN "restricted_shares";

COMMIT;
