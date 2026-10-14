BEGIN;

DROP INDEX IF EXISTS "exagram"."comments_created_at_idx";
DROP TABLE IF EXISTS "exagram"."notification_preferences";

COMMIT;
