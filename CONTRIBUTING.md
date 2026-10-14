# Contributing to Exagram

Thanks for helping. This page covers how to get a working checkout, what to run before you open a pull request, and the
rules the code depends on. [AGENTS.md](AGENTS.md) has the same rules in more detail, written for people and coding
agents alike, and [CONTEXT.md](CONTEXT.md) has the words to use when naming anything.

Found a bug or want a feature? Open an issue with the matching template first, so the change can be discussed before you
write it. Security problems never go in an issue: see [SECURITY.md](SECURITY.md).

## Getting a working checkout

Follow [Running it locally](README.md#running-it-locally) in the README. To work on the database queries you also need
`sqlc` 1.29.0; `mise install` installs it, and Node, at the versions the repo pins.

## Before you open a pull request

```bash
pnpm typecheck --continue && pnpm lint --continue && pnpm test --continue
pnpm test:integration --continue        # needs Docker: each run starts its own Postgres with Testcontainers
pnpm --filter @exagram/<pkg> test       # one package
pnpm format:fix
```

`--continue` reports every failing package rather than stopping at the first. Turbo caches results; add `--force` to
rerun a cached task. Web tests on a Node newer than 24 fail on `localStorage.clear`; use Node 24, or set
`NODE_OPTIONS=--no-experimental-webstorage`.

Run integration tests when you touch the database, a repository, a usecase or an MCP tool. If you change anything under
`deploy/`, `scripts/selfhost-e2e.sh C0` runs a full install the way an operator would (it needs Docker).

## Pull requests

- Keep a pull request to one change, and say what it changes and why, and how you tested it. The template asks for this.
- CI runs unit and integration tests on every push, and typecheck and lint on every push once the pull request is out of
  draft. The `sqlc` check and the image smoke tests run when the pull request is opened or marked ready for review, and
  on later pushes once a maintainer adds the `ci` label.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org) with a scope: `feat(web): …`, `fix(db): …`,
  `docs: …`. A `!` marks a breaking change.
- User-facing copy follows CONTEXT.md. The UI calls a Project a "folder"; code and the API keep `project`.

## Rules the code depends on

These are easy to break with a well-meant change, and review will hold you to them:

1. **Visibility is decided once, in SQL.** Lists go through `exagram.visible_artifacts(p_kind, p_id)`; a single Artifact
   goes through `exagram.visible_artifact`. No TypeScript re-derives who may read what, and the web app never filters by
   access.
2. **A refusal says nothing.** An Artifact you may not read and an Artifact that does not exist give the same status and
   the same bytes, including in list and search counts. If you add an endpoint or an MCP tool, keep that true.
3. **Every read is recorded** in the Ledger, including refused ones.
4. **Environment variables are parsed once**, by the zod schemas in the `*env.ts` modules. A new variable goes in its
   schema and in `.env.example`, and in `deploy/` if people running their own install need it.

[AGENTS.md](AGENTS.md#invariants--never-break-these) lists the rest.

## Database changes

- A migration is a golang-migrate pair in `database/postgres/migrations`; the rules are in
  [migrations.README.md](database/postgres/migrations/migrations.README.md). Take the next free number from the current
  `main`, and renumber if someone merges one first.
- Every `up` needs a working `down`: run `make local-migrate-roundtrip`.
- A new table goes in the expected list in `packages/core/test/pg.integration.test.ts`.
- Queries live in `database/postgres/queries` and are compiled by sqlc into `packages/core/repository/postgres/gen`,
  which is committed. Regenerate against a throwaway database as the sqlc section of [AGENTS.md](AGENTS.md#sqlc)
  describes.

## The local database

`make local-db-init` also writes `dbhub.toml` (git-ignored; `dbhub.example.toml` shows its shape), so an MCP client
running the `dbhub` server can run read-only SQL against your local database.

Every git worktree of the repo can have its own database on the same Postgres server. The main checkout uses `exagram`;
a linked worktree uses `exagram_<directory>_<path hash>`, which `make -s local-db-name` prints. Run `make local-db-init`
in each new worktree before anything else touches the database, and reset a worktree's data with `make local-db-drop`
rather than `docker compose down -v`, which deletes every worktree's database. The apps' ports (3000, 3002 and 5173) are
not shared, so run one worktree's stack at a time, or see the Local stack section of [AGENTS.md](AGENTS.md#local-stack)
for running a second one natively on other ports.
