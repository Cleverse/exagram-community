BEGIN;

DROP INDEX IF EXISTS "exagram"."artifacts_title_tsv_idx";
DROP INDEX IF EXISTS "exagram"."revisions_search_tsv_idx";

ALTER TABLE "exagram"."artifacts" DROP COLUMN IF EXISTS "title_tsv";
ALTER TABLE "exagram"."revisions" DROP COLUMN IF EXISTS "search_tsv";

COMMIT;
