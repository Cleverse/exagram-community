BEGIN;

DROP TRIGGER IF EXISTS "access_requests_notify" ON "exagram"."access_requests";
DROP FUNCTION IF EXISTS "exagram".access_requests_notify();
DROP TABLE IF EXISTS "exagram"."access_requests";

COMMIT;
