BEGIN;

-- A Reset Link (ADR 0034): one per account, single use, kept only as the hash of its token. Creating
-- another for the same account replaces it; using it deletes the row. Null created_by is the server
-- operator's command.
CREATE TABLE "exagram"."password_resets" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" UUID NOT NULL UNIQUE REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"token_hash" TEXT NOT NULL UNIQUE,
	"created_by" UUID REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"expires_at" TIMESTAMPTZ NOT NULL
);

-- The server operator's Reset Link command is a Ledger call of its own kind and surface; its
-- principal_id is the account it acted on.
ALTER TABLE "exagram"."ledger_calls"
	DROP CONSTRAINT "ledger_calls_principal_kind_check",
	ADD CONSTRAINT "ledger_calls_principal_kind_check"
		CHECK ("principal_kind" IN ('user','connection','link','operator')),
	DROP CONSTRAINT "ledger_calls_surface_check",
	ADD CONSTRAINT "ledger_calls_surface_check" CHECK ("surface" IN ('web','mcp','link','operator'));

COMMIT;
