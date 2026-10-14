BEGIN;

SET LOCAL lock_timeout = '5s';

-- A request opened by a verified email holds no credential the old rule accepts, so rolling back drops it. Its
-- person signs in again and the request reopens.
DELETE FROM "exagram"."join_requests"
WHERE "declined_at" IS NULL AND "password_hash" IS NULL AND "google_subject" IS NULL;

ALTER TABLE "exagram"."join_requests" DROP CONSTRAINT "join_requests_credential_check";
ALTER TABLE "exagram"."join_requests"
	ADD CONSTRAINT "join_requests_check"
	CHECK ("declined_at" IS NOT NULL OR "password_hash" IS NOT NULL OR "google_subject" IS NOT NULL);
ALTER TABLE "exagram"."join_requests" DROP COLUMN "email_verified";

DROP TABLE "exagram"."email_sign_ins";

COMMIT;
