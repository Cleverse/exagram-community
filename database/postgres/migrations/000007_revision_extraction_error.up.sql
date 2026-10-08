BEGIN;

ALTER TABLE "exagram"."revisions"
	ADD COLUMN "extraction_error" text NULL;

COMMENT ON COLUMN "exagram"."revisions"."extraction_error" IS
	'Parser failure message when extraction_status = ''failed''; NULL otherwise.';

COMMIT;
