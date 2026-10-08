BEGIN;

DROP TRIGGER IF EXISTS "links_notify_revoked" ON "exagram"."links";
DROP TRIGGER IF EXISTS "comments_notify" ON "exagram"."comments";
DROP TRIGGER IF EXISTS "projects_notify_update" ON "exagram"."projects";
DROP TRIGGER IF EXISTS "projects_notify_insert_delete" ON "exagram"."projects";
DROP TRIGGER IF EXISTS "grants_notify_update" ON "exagram"."grants";
DROP TRIGGER IF EXISTS "grants_notify_insert_delete" ON "exagram"."grants";
DROP TRIGGER IF EXISTS "revisions_notify_redaction" ON "exagram"."revisions";
DROP TRIGGER IF EXISTS "revisions_notify_status" ON "exagram"."revisions";
DROP TRIGGER IF EXISTS "revisions_notify_insert" ON "exagram"."revisions";
DROP TRIGGER IF EXISTS "artifacts_notify_removed" ON "exagram"."artifacts";
DROP TRIGGER IF EXISTS "artifacts_notify_artifact" ON "exagram"."artifacts";
DROP TRIGGER IF EXISTS "artifacts_notify_current" ON "exagram"."artifacts";
DROP TRIGGER IF EXISTS "artifacts_notify_insert" ON "exagram"."artifacts";

DROP FUNCTION IF EXISTS "exagram".links_notify();
DROP FUNCTION IF EXISTS "exagram".comments_notify();
DROP FUNCTION IF EXISTS "exagram".projects_notify();
DROP FUNCTION IF EXISTS "exagram".grants_notify();
DROP FUNCTION IF EXISTS "exagram".revisions_notify();
DROP FUNCTION IF EXISTS "exagram".artifacts_notify();
DROP FUNCTION IF EXISTS "exagram".reach_set(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS "exagram".notify_change(uuid, uuid, uuid, text, uuid[], uuid[]);

COMMIT;
