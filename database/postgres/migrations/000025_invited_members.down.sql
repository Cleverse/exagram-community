BEGIN;

ALTER TABLE "exagram"."users" DROP COLUMN "invited_at";

COMMIT;
