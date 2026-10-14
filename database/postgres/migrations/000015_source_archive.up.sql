BEGIN;

CREATE SCHEMA "source_archive";
REVOKE ALL ON SCHEMA "source_archive" FROM PUBLIC;

CREATE TABLE "source_archive"."runs" (
	"id" UUID PRIMARY KEY,
	"source_digest" TEXT NOT NULL CHECK ("source_digest" ~ '^[0-9a-f]{64}$'),
	"objects_digest" TEXT NOT NULL CHECK ("objects_digest" ~ '^[0-9a-f]{64}$'),
	"status" TEXT NOT NULL CHECK ("status" IN ('loading', 'verified')),
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"verified_at" TIMESTAMPTZ
);

CREATE TABLE "source_archive"."rows" (
	"run_id" UUID NOT NULL REFERENCES "source_archive"."runs"("id") ON DELETE CASCADE,
	"source_table" TEXT NOT NULL CHECK ("source_table" IN (
		'artifacts', 'artifact_revisions', 'artifact_grants', 'artifact_projects',
		'artifact_project_grants', 'artifact_comments', 'artifact_revision_text',
		'artifact_revision_ai', 'artifact_revision_preview', 'allowed_emails',
		'oauth_clients', 'source_principals'
	)),
	"source_pk" TEXT NOT NULL,
	"row_json" TEXT NOT NULL,
	"sha256" TEXT NOT NULL CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
	"schema_fingerprint" TEXT NOT NULL CHECK ("schema_fingerprint" ~ '^[0-9a-f]{64}$'),
	PRIMARY KEY ("run_id", "source_table", "source_pk")
);

CREATE TABLE "source_archive"."objects" (
	"run_id" UUID NOT NULL REFERENCES "source_archive"."runs"("id") ON DELETE CASCADE,
	"source_key" TEXT NOT NULL,
	"row_json" TEXT,
	"present" BOOLEAN NOT NULL,
	"bytes" BIGINT,
	"sha256" TEXT,
	"archive_key" TEXT,
	PRIMARY KEY ("run_id", "source_key"),
	CONSTRAINT "object_presence" CHECK (
		("present" AND "bytes" >= 0 AND "sha256" ~ '^[0-9a-f]{64}$' AND "archive_key" IS NOT NULL)
		OR (NOT "present" AND "bytes" IS NULL AND "sha256" IS NULL AND "archive_key" IS NULL)
	)
);

COMMIT;
