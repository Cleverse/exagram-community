BEGIN;

SET LOCAL lock_timeout = '5s';

-- An Email Sign-in: one live challenge per address, single use, kept only as hashes of the link's token and
-- of the six-digit code. Asking again for the same address replaces it; using it deletes the row; `attempts` counts the
-- codes tried against it, and `sends` the emails asked for since `window_started_at`, which is the per-address limit.
-- The address needs no account: signing in with it creates one.
CREATE TABLE "exagram"."email_sign_ins" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" public.CITEXT NOT NULL UNIQUE,
	"token_hash" TEXT NOT NULL UNIQUE,
	"code_hash" TEXT NOT NULL,
	"attempts" SMALLINT NOT NULL DEFAULT 0,
	"sends" SMALLINT NOT NULL DEFAULT 1,
	"window_started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"expires_at" TIMESTAMPTZ NOT NULL
);

CREATE INDEX "email_sign_ins_expires_at_idx" ON "exagram"."email_sign_ins" ("expires_at");

-- A Join Request opened by a verified email address holds no password and no Google subject: the proof of the address
-- is the credential. Only an open request needs one; a declined request holds none.
ALTER TABLE "exagram"."join_requests" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
	credential_check TEXT;
BEGIN
	SELECT c.conname INTO credential_check
	FROM pg_constraint c
	WHERE c.conrelid = '"exagram"."join_requests"'::regclass
	  AND c.contype = 'c'
	  AND pg_get_constraintdef(c.oid) LIKE '%google_subject%';
	IF credential_check IS NOT NULL THEN
		EXECUTE format('ALTER TABLE "exagram"."join_requests" DROP CONSTRAINT %I', credential_check);
	END IF;
END $$;

ALTER TABLE "exagram"."join_requests"
	ADD CONSTRAINT "join_requests_credential_check"
	CHECK ("declined_at" IS NOT NULL OR "password_hash" IS NOT NULL OR "google_subject" IS NOT NULL OR "email_verified");

COMMIT;
