BEGIN;

ALTER TABLE "exagram"."artifacts" DROP CONSTRAINT IF EXISTS "artifacts_current_revision_fk";

DROP TRIGGER IF EXISTS "links_revision_check" ON "exagram"."links";
DROP FUNCTION IF EXISTS "exagram".links_revision_check();
DROP TABLE IF EXISTS "exagram"."links";

DROP TABLE IF EXISTS "exagram"."comments";

DROP TRIGGER IF EXISTS "grants_pin_check" ON "exagram"."grants";
DROP FUNCTION IF EXISTS "exagram".grants_pin_check();
DROP TABLE IF EXISTS "exagram"."grants";

DROP TABLE IF EXISTS "exagram"."revisions";
DROP TABLE IF EXISTS "exagram"."artifacts";

DROP TRIGGER IF EXISTS "projects_depth_check" ON "exagram"."projects";
DROP FUNCTION IF EXISTS "exagram".projects_depth_check();
DROP TABLE IF EXISTS "exagram"."projects";

COMMIT;
