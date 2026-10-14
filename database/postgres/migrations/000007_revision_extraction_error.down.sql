BEGIN;

ALTER TABLE "exagram"."revisions"
	DROP COLUMN IF EXISTS "extraction_error";

COMMIT;
