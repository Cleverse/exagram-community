BEGIN;

-- NOT VALID keeps the operator's past Ledger calls rather than deleting history; new rows are checked.
ALTER TABLE "exagram"."ledger_calls"
	DROP CONSTRAINT "ledger_calls_principal_kind_check",
	ADD CONSTRAINT "ledger_calls_principal_kind_check"
		CHECK ("principal_kind" IN ('user','connection','link')) NOT VALID,
	DROP CONSTRAINT "ledger_calls_surface_check",
	ADD CONSTRAINT "ledger_calls_surface_check" CHECK ("surface" IN ('web','mcp','link')) NOT VALID;

DROP TABLE "exagram"."password_resets";

COMMIT;
