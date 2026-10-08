BEGIN;

ALTER TABLE "exagram"."ledger_calls" DROP COLUMN "subject";

DROP TABLE "exagram"."workspace_invites";

COMMIT;
