BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE "exagram"."projects", "exagram"."sessions", "exagram"."ledger_calls" IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER "ledger_calls_default_workspace" ON "exagram"."ledger_calls";
DROP FUNCTION "exagram".ledger_calls_default_workspace();
DROP FUNCTION "exagram".ledger_call_workspace(text, uuid);

DROP TRIGGER "sessions_notify_switch" ON "exagram"."sessions";
DROP FUNCTION "exagram".sessions_notify_switch();

DROP TRIGGER "projects_release_grants" ON "exagram"."projects";
DROP FUNCTION "exagram".projects_release_grants();

UPDATE "exagram"."sessions" s SET workspace_id = u.workspace_id
FROM "exagram"."users" u
WHERE u.id = s.user_id AND s.workspace_id IS DISTINCT FROM u.workspace_id;

CREATE OR REPLACE FUNCTION "exagram".grants_notify() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_row        "exagram"."grants"%ROWTYPE;
  v_project_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  IF v_row.artifact_id IS NOT NULL THEN
    SELECT a.project_id INTO v_project_id FROM "exagram"."artifacts" a WHERE a.id = v_row.artifact_id;
  ELSE
    v_project_id := v_row.project_id;
  END IF;

  PERFORM "exagram".notify_change(u.workspace_id, v_row.artifact_id, v_project_id, 'reach', ARRAY[v_row.grantee_id])
     FROM "exagram"."users" u
    WHERE u.id = v_row.grantee_id;
  RETURN NULL;
END $$;

COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "exagram"."workspaces" DROP COLUMN IF EXISTS "notification_email_resumed_at";
COMMIT;
