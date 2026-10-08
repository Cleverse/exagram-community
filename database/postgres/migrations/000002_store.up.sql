BEGIN;

CREATE TABLE "exagram"."projects" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id"),
	"owner_id" UUID NOT NULL REFERENCES "exagram"."users"("id"),
	"parent_project_id" UUID REFERENCES "exagram"."projects"("id"),
	"name" TEXT NOT NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT "projects_no_self_parent" CHECK ("parent_project_id" IS DISTINCT FROM "id")
);

-- unique (owner_id, parent_project_id, name). NULL never equals NULL in a plain unique constraint,
-- so root-level duplicates would slip through; the sentinel makes the NULL case unique too.
CREATE UNIQUE INDEX "projects_owner_parent_name_key"
	ON "exagram"."projects" (
		"owner_id",
		COALESCE("parent_project_id", '00000000-0000-0000-0000-000000000000'::UUID),
		"name"
	);

CREATE INDEX "projects_parent_project_id_idx" ON "exagram"."projects" ("parent_project_id");

-- One level of sub-Project deep: a project with a parent cannot itself be a parent.
CREATE FUNCTION "exagram".projects_depth_check() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.parent_project_id IS NULL THEN
		RETURN NEW;
	END IF;

	IF EXISTS (
		SELECT 1 FROM "exagram"."projects" p
		WHERE p.id = NEW.parent_project_id AND p.parent_project_id IS NOT NULL
	) THEN
		RAISE EXCEPTION 'project % already has a parent and cannot be a parent', NEW.parent_project_id
			USING ERRCODE = 'check_violation';
	END IF;

	IF EXISTS (SELECT 1 FROM "exagram"."projects" c WHERE c.parent_project_id = NEW.id) THEN
		RAISE EXCEPTION 'project % has children and cannot be given a parent', NEW.id
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$;

CREATE TRIGGER "projects_depth_check"
	BEFORE INSERT OR UPDATE ON "exagram"."projects"
	FOR EACH ROW EXECUTE FUNCTION "exagram".projects_depth_check();

CREATE TABLE "exagram"."artifacts" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"workspace_id" UUID NOT NULL REFERENCES "exagram"."workspaces"("id"),
	"owner_id" UUID NOT NULL REFERENCES "exagram"."users"("id"),
	"project_id" UUID REFERENCES "exagram"."projects"("id"),
	"kind" TEXT NOT NULL CHECK ("kind" IN ('doc','html','chat','pdf','docx','pptx','xlsx')),
	"title" TEXT NOT NULL,
	"current_revision_id" UUID,
	"default_pin" TEXT NOT NULL DEFAULT 'latest' CHECK ("default_pin" IN ('latest','current')),
	"deleted_at" TIMESTAMPTZ,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "artifacts_owner_id_idx" ON "exagram"."artifacts" ("owner_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "artifacts_project_id_idx" ON "exagram"."artifacts" ("project_id") WHERE "deleted_at" IS NULL;

CREATE TABLE "exagram"."revisions" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"artifact_id" UUID NOT NULL REFERENCES "exagram"."artifacts"("id") ON DELETE CASCADE,
	"seq" INTEGER NOT NULL,
	"status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','approved','discarded')),
	"author_user_id" UUID NOT NULL REFERENCES "exagram"."users"("id"),
	-- The foreign key to connections is added in 000003; connections does not exist yet.
	"author_connection_id" UUID,
	"storage_key" TEXT NOT NULL,
	"mime" TEXT NOT NULL,
	"bytes" INTEGER NOT NULL CHECK ("bytes" > 0 AND "bytes" <= 20971520),
	"sha256" TEXT NOT NULL,
	"note" TEXT,
	"extracted_text" TEXT,
	"extraction_status" TEXT NOT NULL DEFAULT 'none'
		CHECK ("extraction_status" IN ('none','queued','done','failed')),
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	"approved_at" TIMESTAMPTZ,
	CONSTRAINT "revisions_artifact_seq_key" UNIQUE ("artifact_id", "seq")
);

CREATE INDEX "revisions_artifact_status_idx" ON "exagram"."revisions" ("artifact_id", "status");
CREATE INDEX "revisions_author_user_id_idx" ON "exagram"."revisions" ("author_user_id");

ALTER TABLE "exagram"."artifacts"
	ADD CONSTRAINT "artifacts_current_revision_fk"
	FOREIGN KEY ("current_revision_id") REFERENCES "exagram"."revisions"("id");

CREATE TABLE "exagram"."grants" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"artifact_id" UUID REFERENCES "exagram"."artifacts"("id") ON DELETE CASCADE,
	"project_id" UUID REFERENCES "exagram"."projects"("id") ON DELETE CASCADE,
	"grantee_id" UUID NOT NULL REFERENCES "exagram"."users"("id") ON DELETE CASCADE,
	"role" TEXT NOT NULL CHECK ("role" IN ('view','edit')),
	"pinned_revision_id" UUID REFERENCES "exagram"."revisions"("id"),
	"created_by" UUID NOT NULL REFERENCES "exagram"."users"("id"),
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
	CONSTRAINT "grants_subject_xor" CHECK (("artifact_id" IS NULL) <> ("project_id" IS NULL))
);

CREATE UNIQUE INDEX "grants_artifact_grantee_key"
	ON "exagram"."grants" ("artifact_id", "grantee_id") WHERE "artifact_id" IS NOT NULL;
CREATE UNIQUE INDEX "grants_project_grantee_key"
	ON "exagram"."grants" ("project_id", "grantee_id") WHERE "project_id" IS NOT NULL;
CREATE INDEX "grants_grantee_id_idx" ON "exagram"."grants" ("grantee_id");

-- A Pin is a Grant fixed to one approved Revision of that same Artifact. A Project grant covers
-- many artifacts, so it can never carry one.
CREATE FUNCTION "exagram".grants_pin_check() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.pinned_revision_id IS NULL THEN
		RETURN NEW;
	END IF;

	IF NEW.artifact_id IS NULL THEN
		RAISE EXCEPTION 'a project grant cannot carry a pinned revision'
			USING ERRCODE = 'check_violation';
	END IF;

	IF NOT EXISTS (
		SELECT 1 FROM "exagram"."revisions" r
		WHERE r.id = NEW.pinned_revision_id
		  AND r.artifact_id = NEW.artifact_id
		  AND r.status = 'approved'
	) THEN
		RAISE EXCEPTION 'revision % is not an approved revision of artifact %',
			NEW.pinned_revision_id, NEW.artifact_id
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$;

CREATE TRIGGER "grants_pin_check"
	BEFORE INSERT OR UPDATE ON "exagram"."grants"
	FOR EACH ROW EXECUTE FUNCTION "exagram".grants_pin_check();

CREATE TABLE "exagram"."comments" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"revision_id" UUID NOT NULL REFERENCES "exagram"."revisions"("id") ON DELETE CASCADE,
	"author_id" UUID NOT NULL REFERENCES "exagram"."users"("id"),
	"body" TEXT NOT NULL,
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "comments_revision_id_idx" ON "exagram"."comments" ("revision_id", "created_at");

CREATE TABLE "exagram"."links" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"artifact_id" UUID NOT NULL REFERENCES "exagram"."artifacts"("id") ON DELETE CASCADE,
	"revision_id" UUID NOT NULL REFERENCES "exagram"."revisions"("id"),
	"token_hash" TEXT NOT NULL UNIQUE,
	"expires_at" TIMESTAMPTZ NOT NULL,
	"max_views" INTEGER CHECK ("max_views" IS NULL OR "max_views" > 0),
	"views_used" INTEGER NOT NULL DEFAULT 0 CHECK ("views_used" >= 0),
	"revoked_at" TIMESTAMPTZ,
	"created_by" UUID NOT NULL REFERENCES "exagram"."users"("id"),
	"created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "links_artifact_id_idx" ON "exagram"."links" ("artifact_id");

-- A Link never follows latest (ADR 0014), so its revision must be an approved revision of the
-- artifact it names.
CREATE FUNCTION "exagram".links_revision_check() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "exagram"."revisions" r
		WHERE r.id = NEW.revision_id
		  AND r.artifact_id = NEW.artifact_id
		  AND r.status = 'approved'
	) THEN
		RAISE EXCEPTION 'revision % is not an approved revision of artifact %',
			NEW.revision_id, NEW.artifact_id
			USING ERRCODE = 'check_violation';
	END IF;

	RETURN NEW;
END;
$$;

CREATE TRIGGER "links_revision_check"
	BEFORE INSERT OR UPDATE ON "exagram"."links"
	FOR EACH ROW EXECUTE FUNCTION "exagram".links_revision_check();

COMMIT;
