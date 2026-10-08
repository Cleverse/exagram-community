BEGIN;

-- An Admin's offer for one email to join their Workspace with a role (ADR 0023 §2). Only the hash of
-- the Join Link's token is kept, so the link is shown once; renewing mints a new one. Accepting or
-- revoking deletes the row.
CREATE TABLE "exagram"."workspace_invites" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id") ON DELETE CASCADE,
	"email" public.CITEXT NOT NULL,
	"role" TEXT NOT NULL CHECK ("role" IN ('admin','member')),
	"token_hash" TEXT NOT NULL UNIQUE,
	"invited_by" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"expires_at" TIMESTAMPTZ NOT NULL,
	UNIQUE ("workspace_id", "email")
);

CREATE INDEX "workspace_invites_email_idx" ON "exagram"."workspace_invites" ("email");

-- Whom an Admin action on the Workspace acted on; for an Invite action, the invited email.
ALTER TABLE "exagram"."ledger_calls" ADD COLUMN "subject" TEXT;

COMMIT;
