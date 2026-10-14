BEGIN;

SET LOCAL lock_timeout = '5s';

-- A Join Request opened by Sign in with Apple holds the Apple subject, as one opened by Google holds the
-- Google subject, so approving it attaches the identity its person signs in with. An open request still holds exactly
-- the credential it was opened with; a declined one holds none.
ALTER TABLE "exagram"."join_requests" ADD COLUMN "apple_subject" TEXT;

ALTER TABLE "exagram"."join_requests" DROP CONSTRAINT "join_requests_credential_check";
ALTER TABLE "exagram"."join_requests"
	ADD CONSTRAINT "join_requests_credential_check"
	CHECK ("declined_at" IS NOT NULL OR "password_hash" IS NOT NULL OR "google_subject" IS NOT NULL
		OR "apple_subject" IS NOT NULL OR "email_verified");

COMMIT;
