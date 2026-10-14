BEGIN;

DROP TABLE IF EXISTS "exagram"."sessions";
DROP TABLE IF EXISTS "exagram"."users";
DROP TABLE IF EXISTS "exagram"."workspaces";

-- No CASCADE: by now the schema holds nothing, and golang-migrate's own version table lives in
-- `public` (see the Makefile's x-migrations-table options), so a plain drop is the honest check
-- that every later down half put its objects back.
DROP SCHEMA IF EXISTS "exagram";

DROP EXTENSION IF EXISTS "citext";

COMMIT;
