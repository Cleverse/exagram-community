BEGIN;

SET LOCAL lock_timeout = '5s';

DELETE FROM "exagram"."join_requests" WHERE "user_id" IS NOT NULL;

ALTER TABLE "exagram"."join_requests" DROP COLUMN "user_id";

COMMIT;
