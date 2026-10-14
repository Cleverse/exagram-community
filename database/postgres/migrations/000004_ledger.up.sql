BEGIN;

CREATE TABLE "exagram"."ledger_calls" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"principal_kind" TEXT NOT NULL CHECK ("principal_kind" IN ('user','connection','link')),
	"principal_id" UUID NOT NULL,
	"surface" TEXT NOT NULL CHECK ("surface" IN ('web','mcp','link')),
	"action" TEXT NOT NULL,
	"status" TEXT NOT NULL DEFAULT 'authorized'
		CHECK ("status" IN ('authorized','delivered','failed')),
	"started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"delivered_at" TIMESTAMPTZ,
	"body_sha256" TEXT
);

CREATE INDEX "ledger_calls_principal_idx"
	ON "exagram"."ledger_calls" ("principal_kind", "principal_id", "started_at" DESC);

CREATE TABLE "exagram"."ledger_serves" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"call_id" UUID NOT NULL REFERENCES "exagram"."ledger_calls"("id") ON DELETE CASCADE,
	-- A plain uuid, deliberately: a withheld row must be able to name an id that does not exist,
	-- so a foreign key here would turn "not found" into a constraint error. Null is the third case:
	-- a call that served no Artifact at all, such as project_list, still writes exactly one row.
	"artifact_id" UUID,
	"revision_id" UUID,
	"outcome" TEXT NOT NULL CHECK ("outcome" IN ('served','withheld')),
	"reason" TEXT,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "ledger_serves_artifact_idx"
	ON "exagram"."ledger_serves" ("artifact_id", "created_at" DESC);
CREATE INDEX "ledger_serves_call_id_idx" ON "exagram"."ledger_serves" ("call_id");

COMMIT;
