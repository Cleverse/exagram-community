BEGIN;

DROP TABLE "exagram"."user_identities";

DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "exagram"."users" WHERE "password_hash" IS NULL) THEN
		RAISE EXCEPTION 'cannot restore users.password_hash NOT NULL while null password hashes exist';
	END IF;
END
$$;

ALTER TABLE "exagram"."users" ALTER COLUMN "password_hash" SET NOT NULL;

COMMIT;
