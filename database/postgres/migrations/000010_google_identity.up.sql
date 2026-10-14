BEGIN;

ALTER TABLE "exagram"."users" ALTER COLUMN "password_hash" DROP NOT NULL;

CREATE TABLE "exagram"."user_identities" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"provider" TEXT NOT NULL,
	"subject" TEXT NOT NULL,
	"email" public.CITEXT NOT NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	UNIQUE ("provider", "subject"),
	UNIQUE ("user_id", "provider")
);

COMMIT;
