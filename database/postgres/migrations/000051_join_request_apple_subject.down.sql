BEGIN;

SET LOCAL lock_timeout = '5s';

-- A request opened by Apple holds no credential the old rule accepts, so rolling back drops it. Its person asks again.
DELETE FROM "exagram"."join_requests"
WHERE "declined_at" IS NULL AND "password_hash" IS NULL AND "google_subject" IS NULL AND NOT "email_verified";

ALTER TABLE "exagram"."join_requests" DROP CONSTRAINT "join_requests_credential_check";
ALTER TABLE "exagram"."join_requests"
	ADD CONSTRAINT "join_requests_credential_check"
	CHECK ("declined_at" IS NOT NULL OR "password_hash" IS NOT NULL OR "google_subject" IS NOT NULL OR "email_verified");
ALTER TABLE "exagram"."join_requests" DROP COLUMN "apple_subject";

COMMIT;
