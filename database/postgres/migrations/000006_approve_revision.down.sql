-- database/postgres/migrations/000006_approve_revision.down.sql
DROP FUNCTION IF EXISTS exagram.approve_revision(uuid, uuid);
