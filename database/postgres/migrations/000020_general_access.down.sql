BEGIN;

DROP FUNCTION "exagram".visible_artifact(TEXT, UUID, UUID);
DROP TABLE "exagram"."workspace_org_domains";
ALTER TABLE "exagram"."artifacts" DROP COLUMN "general_access";

COMMIT;
