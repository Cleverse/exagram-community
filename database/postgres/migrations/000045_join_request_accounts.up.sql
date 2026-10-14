BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE "exagram"."join_requests"
	ADD COLUMN "user_id" UUID REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	ADD CONSTRAINT "join_requests_account_via_check" CHECK ("user_id" IS NULL OR "via" = 'member_invite');

CREATE INDEX "join_requests_user_idx" ON "exagram"."join_requests" ("user_id") WHERE "user_id" IS NOT NULL;

COMMIT;
