BEGIN;

DROP FUNCTION IF EXISTS "exagram".notification_email_confirmation_retry_after(UUID, INTEGER);
DROP FUNCTION IF EXISTS "exagram".notification_email_verified(UUID);
DROP TABLE IF EXISTS "exagram"."notification_email_confirmations";
DROP FUNCTION IF EXISTS "exagram".canonical_email_address(TEXT);
DROP TABLE IF EXISTS "exagram"."notification_email_deliveries";

ALTER TABLE "exagram"."workspaces" DROP COLUMN IF EXISTS "notification_email_enabled";

ALTER TABLE "exagram"."notification_preferences"
	DROP COLUMN IF EXISTS "email_cadence",
	DROP COLUMN IF EXISTS "email_access_requests",
	DROP COLUMN IF EXISTS "email_pending_revisions",
	DROP COLUMN IF EXISTS "email_grants",
	DROP COLUMN IF EXISTS "email_comments",
	DROP COLUMN IF EXISTS "digest_hour",
	DROP COLUMN IF EXISTS "time_zone";

COMMIT;
