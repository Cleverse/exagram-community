BEGIN;

ALTER TABLE "exagram"."revisions"
	ADD COLUMN "search_tsv" tsvector
		GENERATED ALWAYS AS (to_tsvector('simple', left(coalesce("extracted_text", ''), 900000))) STORED;

ALTER TABLE "exagram"."artifacts"
	ADD COLUMN "title_tsv" tsvector
		GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", ''))) STORED;

CREATE INDEX "revisions_search_tsv_idx" ON "exagram"."revisions" USING GIN ("search_tsv");
CREATE INDEX "artifacts_title_tsv_idx" ON "exagram"."artifacts" USING GIN ("title_tsv");

COMMIT;
