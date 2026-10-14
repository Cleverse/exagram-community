BEGIN;

-- The stripped expiresWithSession flag is not restored: the up migration does not record which rows had it.

COMMIT;
