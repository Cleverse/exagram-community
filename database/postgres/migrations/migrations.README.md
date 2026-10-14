# Database migrations

Plain-SQL golang-migrate pairs. The runner is the `migrate/migrate` container pinned by digest in the repo `Makefile`,
so nobody installs a Go binary and CI needs no setup step.

## Numbering

`000001_name.up.sql` and `000001_name.down.sql`, lexically ordered, one pair per migration. Mint a pair with:

    docker run --rm -v "$PWD/database/postgres/migrations:/migrations" $MIGRATE_IMAGE \
      create -ext sql -dir /migrations -seq <name>

## Running

    make local-migrate-up             # applies every pair
    make local-migrate-down           # reverses twelve; pass STEPS=n for fewer
    make local-migrate-roundtrip

`DATABASE_URL` must carry the `exagram` schema in its search path, with `public` still in it too — `citext` lives in
`public`, and dropping it breaks any query that casts to that type:
`postgres://exagram:exagram@localhost:25432/exagram?sslmode=disable&search_path=exagram%2Cpublic`.

The `Makefile` appends `x-migrations-table-quoted=1` and `x-migrations-table=%22public%22.%22schema_migrations%22` to
that URL for the runner only. The version table has to sit outside `exagram`, because 000001's down half drops that
schema.

The migrate CLI itself runs without `search_path`, because golang-migrate requires that schema to already exist at
connection open and 000001 is what creates it; the `Makefile` strips it from `DATABASE_URL` before invoking the runner.

## Forward references

A table may only reference a table created in the same or an earlier migration. `revisions` declares
`author_connection_id` as a bare UUID in `000002` and `000003` adds the foreign key once `connections` exists — the
reverse order stops the runner dead.

## A failed migration

Each half runs in one transaction, so a failure leaves the schema as it was, but golang-migrate marks the version dirty
and refuses to continue. After a failed up half of migration N, the version reads N dirty with the schema still at N-1:
run `migrate force N-1`, then `up`. After a failed down half, the version reads N-1 dirty with the schema still at N:
run `migrate force N`, then `down 1`.

## Rolling back 000018

`000018_collaborator_role` down turns every Collaborator Grant into a Viewer one and drops the publish policy columns. A
Revision an Owner or Editor published on upload keeps its `approved` status and stays Current: the rollback does not
unpublish anything.

## Join dates before `000033_members`

`000033_members` adds a join date, which a claim of an Invited Member's row sets. A membership claimed before the
migration has none, so the Team list dates it from its `created_at`, the day it was first shared with.
