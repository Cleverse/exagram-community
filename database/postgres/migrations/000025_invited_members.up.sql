BEGIN;

-- A Member made by sharing with an email nobody held yet. Set while the row is unclaimed and cleared
-- at the person's first Google sign-in. While it is set, the row may be discarded: when its last Grant
-- goes, or when the person signs in with Google asking for a different Workspace. So sharing with an
-- email never keeps its owner out of the Workspace they choose.
ALTER TABLE "exagram"."users" ADD COLUMN "invited_at" timestamptz;

COMMIT;
