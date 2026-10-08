BEGIN;

DROP FUNCTION IF EXISTS "exagram".pending_revisions(UUID);
DROP FUNCTION IF EXISTS "exagram".visible_artifacts(TEXT, UUID);
DROP FUNCTION IF EXISTS "exagram".artifact_owner(UUID);

COMMIT;
