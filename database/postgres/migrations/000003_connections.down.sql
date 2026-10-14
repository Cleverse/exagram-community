BEGIN;

DROP INDEX IF EXISTS "exagram"."revisions_author_connection_id_idx";
ALTER TABLE "exagram"."revisions" DROP CONSTRAINT IF EXISTS "revisions_author_connection_fk";

DROP TABLE IF EXISTS "exagram"."connections";
DROP TABLE IF EXISTS "exagram"."oidc_payloads";

COMMIT;
