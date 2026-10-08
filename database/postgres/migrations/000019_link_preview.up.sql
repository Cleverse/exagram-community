BEGIN;

-- Link previews (ADR 0019): what an unfurler (Slackbot and friends) sees when an Exagram URL is
-- pasted somewhere. 'metadata' shows the title, kind and workspace name to anyone holding the URL;
-- 'generic' shows the same page an unknown id gets. Never a body. A Project carries its own value
-- (a child Project does not inherit its parent's); an Artifact outside any Project follows 'metadata'.
ALTER TABLE "exagram"."projects" ADD COLUMN "link_preview" TEXT NOT NULL DEFAULT 'metadata'
	CHECK ("link_preview" IN ('metadata', 'generic'));

COMMIT;
