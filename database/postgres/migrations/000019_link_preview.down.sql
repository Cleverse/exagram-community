BEGIN;

ALTER TABLE "exagram"."projects" DROP COLUMN IF EXISTS "link_preview";

COMMIT;
