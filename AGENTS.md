# AGENTS.md

Exagram: a store for documents and AI-made Artifacts, shared with named people and with AI tools over MCP, where every
read is recorded. Read [CONTEXT.md](CONTEXT.md) before naming anything — it is the ubiquitous language, and its _Avoid_
lists are binding for new code, API fields and UI copy. Quick start is in [README.md](README.md).

## Layout

- `apps/api` — Fastify: human API `/v1` (oRPC), MCP `/mcp`, OAuth `/oauth` (oidc-provider), Link pages `/l/:token`
- `apps/worker` — pg-boss jobs in `src/jobs/*.job.ts` (parse, redact, sweeps)
- `apps/usercontent` — second origin for HTML bodies and the PDF viewer under a no-network CSP
- `apps/web` — React 19 + Vite SPA, `src/features/<feature>/`, `*.mobile.tsx` variants; primitives in `PRIMITIVES.md`
- `packages/core` — oRPC contract (`contract/<area>/`), entities, datagateways, repositories, sqlc output
  (`repository/postgres/gen/`, committed), services, `utils/errors.ts`, `utils/refusal.ts`
- `packages/api-client` (typed client for web), `packages/mcp` (tool registry, `tools/*.tool.ts`), `packages/parser`
  (docx/pdf/pptx/xlsx text), `packages/redactor` (deterministic Finding detection, no network, no models),
  `packages/dotrc` (shared eslint/tsconfig/tsup)
- `database/postgres/migrations` (golang-migrate pairs), `database/postgres/queries` (sqlc input)
- `deploy/` — self-hosted compose + Caddy

API layering is one-way: Router → Usecase → Datagateway → Repository → DB, composed in `apps/api/src/index.ts`. File
suffixes name the layer: `*.router.ts`, `*.usecase.ts`, `*.datagateway.ts`, `*.repository.ts`, `*.service.ts`,
`*.port.ts`, `*.route.ts`, `*.job.ts`, `*.tool.ts`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck --continue && pnpm lint --continue && pnpm test --continue      # turbo; add --ui=stream outside a TTY
pnpm --filter @exagram/<pkg> test               # one package; lint runs typecheck first
pnpm --filter @exagram/<pkg> exec vitest run <file>
pnpm --filter @exagram/<pkg> test:integration   # api, worker, usercontent, core — needs Docker
pnpm format:fix
scripts/selfhost-e2e.sh [A] [B] [C] [G] [NEG]   # Self-hosted deploy/ end to end; needs Docker
```

- Turbo stops at the first failing package; a green rerun after one fix can still hide others — rerun the whole task.
- Turbo caches `lint`, `typecheck`, `test` and `test:integration`, keyed on the package, its workspace dependencies and
  `globalDependencies` in `turbo.json`. Add `--force` to rerun a cached task, e.g. when chasing a flaky test. A test
  that reads a file outside its package needs that path in `globalDependencies`.
- Integration tests start their own Testcontainers `postgres:18`, run serially, and need no `.env` (the vitest configs
  inject placeholders). OrbStack: `export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock`.
- Web tests on a Node newer than the pinned 24 fail on `localStorage.clear`; use mise's Node, or
  `NODE_OPTIONS=--no-experimental-webstorage`.
- E2E (`pnpm --filter @exagram/web test:e2e`) needs the full stack, an empty database and a real signing key in
  `OIDC_JWKS`.
- `pnpm gen` is a no-op. Codegen is `mise run generate` (sqlc + import fixer) and needs a migrated Postgres — see the
  sqlc section.
- macOS has no `timeout`; don't rely on it in scripts.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, check:tsrefs, test, test:integration, `sqlc compile` against
migrated PG 18, and `scripts/image-smoke.sh` (on PRs only when server-image inputs change). Match it locally before
pushing. The last three need Docker. `--continue` reports every failing package, not the first.

## Invariants — never break these

- **A refusal says nothing.** A forbidden or Withheld Artifact read returns the same status and bytes as not-found for
  that caller (`RefusalError`; `REFUSAL_TEXT`, or `NARROWED_REFUSAL_TEXT` for a Connection with Folder Access, in
  `packages/core/utils/refusal.ts`). New endpoints and MCP tools keep this true, including list/search counts.
- **Visibility is decided in SQL**: `exagram.visible_artifacts` for lists, `exagram.visible_artifact` for one Artifact.
  No TypeScript re-derives who can read what; web never filters by access. Folder Access narrows in SQL only.
- **Redaction readiness is one predicate**, applied identically in read, list and search; anything not ready is
  Withheld. Never add an upper bound on detector version.
- **Every read is ledgered**, including Withheld outcomes.
- **Pending Revisions reach nobody** except as CONTEXT.md _Publish Policy_ allows.
- **Env is parsed once**, by zod schemas in `*env.ts` modules (each app's `src/env.ts`,
  `apps/{api,worker}/src/edition.env.ts`, `apps/api/src/oauth/oauth.env.ts`, `apps/api/src/preflight.env.ts`,
  `packages/core/repository/postgres/db.env.ts`, `packages/core/services/storage/storage.env.ts`). Nothing else reads
  `process.env`. A new var goes in its schema, `.env.example`, and — if self-hosters need it — `deploy/compose.yml` and
  `deploy/.env.example`. `env.selfhost.test.ts` only checks that compose's keys are accepted, not that new ones are
  there.
- Errors are `DomainError` subclasses from `packages/core/utils/errors.ts`; the API maps them in one place.
- Usercontent CSP and iframe sandboxing are deliberate: HTML bodies run on their own origin under a no-network CSP.
  Don't loosen or "fix" them.

## Migrations

Rules are in `database/postgres/migrations/migrations.README.md`.

- Take the next number from **current `origin/main`** (`git fetch` first), and recheck right before pushing; whoever
  merges second renumbers.
- A new table must be added to the expected list in `packages/core/test/pg.integration.test.ts`.
- Every `up` needs a working `down`; run `make local-migrate-roundtrip`.
- A local volume that applied a migration under a number that later changed will never apply the real one — reset the
  volume (`docker compose down -v`).
- Migration numbers are immutable once merged.

## sqlc

sqlc cannot resolve `RETURNS TABLE` functions from schema files, so it generates from a live migrated database. Never
point it at a database another worktree is using. A schema change can legitimately change generated files for queries
you did not touch; keep those. The TS plugin emits nothing for `:execrows`; use `:one … RETURNING` or `:many`.

To regenerate after changing a query or migration, use a throwaway Postgres. `sqlc.yaml` points at `localhost:5432`,
which is CI's Postgres service, and another Postgres may own that port locally. `sqlc` 1.29.0 comes from `mise install`;
Docker is needed.

1. Commit other work under `gen/`, then start a throwaway Postgres on a free port. The unique name and `|| exit` keep a
   failed start from reusing, migrating or removing someone else's container:

   ```bash
   PORT=55441; NAME=exagram-sqlc-$$
   docker run -d --rm --name $NAME -p $PORT:5432 -e POSTGRES_USER=exagram -e POSTGRES_PASSWORD=exagram \
     -e POSTGRES_DB=exagram postgres:18 || exit 1
   until docker exec $NAME pg_isready -U exagram -d exagram >/dev/null 2>&1; do sleep 1; done
   ```

2. Apply every migration:

   ```bash
   MIGRATE_IMAGE=$(sed -n 's/^MIGRATE_IMAGE ?= //p' Makefile)
   docker run --rm --add-host=host.docker.internal:host-gateway \
     -v "$PWD/database/postgres/migrations:/migrations" $MIGRATE_IMAGE -path=/migrations \
     -database "postgres://exagram:exagram@host.docker.internal:$PORT/exagram?sslmode=disable&x-migrations-table-quoted=1&x-migrations-table=%22public%22.%22schema_migrations%22" up
   ```

3. Generate against it and fix imports:

   ```bash
   sed "s#localhost:5432#localhost:$PORT#" sqlc.yaml > sqlc.tmp.yaml
   sqlc generate -f sqlc.tmp.yaml && node scripts/fix-sqlc-postgres-imports.mjs
   rm sqlc.tmp.yaml; docker rm -f $NAME
   ```

4. `git diff packages/core/repository/postgres/gen`. Keep every real change; revert only files whose diff is a lone
   trailing newline.
5. `pnpm --filter @exagram/core typecheck`.

Don't run `mise run generate` in a non-TTY; its `pnpm install` step aborts with
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.

## Local stack

Postgres is one shared server on `127.0.0.1:25432` (`EXAGRAM_PG_PORT`), each worktree gets its own database via
`make local-db-init` (main checkout `exagram`, linked worktree `exagram_<dir>_<path hash>`; `make -s local-db-name`
prints it); the other ports (9000/9001, 3000, 3002, 5173) still collide. Before DB-backed work in a worktree run
`make local-db-up && make local-db-init`, and query only this checkout's database.

- First run: `pnpm install`, `make local-db-up`, `make local-db-init` (writes `.env` and `dbhub.toml`, creates and
  migrates the database), then `docker compose up`. Set a real `OIDC_JWKS` in `.env` first if you need OAuth or MCP. Web
  is http://localhost:5173, API :3000, usercontent :3002. Use `CLIENT_IP_HEADER=none` locally.
- Run `make local-db-init` in each new worktree: a copied `.env` points at `exagram` until then, and
  `make local-migrate-up/down` refuse that (override with `ALLOW_OTHER_DB=1`). `FROM=<db> make local-db-init` clones an
  existing database. Reset a worktree's data with `make local-db-drop`, never `down -v`, which deletes every worktree's
  database.
- A linked worktree's database name hashes its absolute path. Moving the worktree orphans the old database; rerun
  `make local-db-init` (`FROM=<old db>` clones the old data).
- In a linked worktree run the apps natively: compose app ports collide with the main checkout. Per app,
  `node --env-file=<copy of .env> --import tsx src/index.ts` with `HTTP_PORT` shifted; web via
  `pnpm --filter @exagram/web exec vite --port 5183 --strictPort` with `VITE_API_PROXY_TARGET` and
  `VITE_USERCONTENT_ORIGIN` pointing at your ports. Shift `WEB_ORIGIN`, `API_ORIGIN`, `USERCONTENT_ORIGIN` and
  `USERCONTENT_FRAME_ANCESTORS` in the env copy to match, or the API's origin guard rejects browser writes.
- `.env` can't be `source`d (unquoted `&`).
- GUI database clients: host `127.0.0.1` (not `localhost`), port 25432, user and password `exagram`, database from
  `make -s local-db-name`.
- E2E needs an empty database and a real key in `OIDC_JWKS`. Run it under its own compose project
  (`COMPOSE_PROJECT_NAME=exagram-e2e EXAGRAM_PG_PORT=25433`) and only ever `down -v` that one.

## Conventions

- TypeScript ESM, strict, `noUncheckedIndexedAccess`. Prettier: tabs, no semicolons, double quotes, width 120,
  `proseWrap: always` (Markdown included — lint-staged reformats on commit).
- Tests are colocated: `*.test.ts(x)` unit, `*.integration.test.ts` integration.
- Commits follow Conventional Commits with a scope (`feat(web): …`, `fix(db): …`); `!` marks breaking.
- User-facing copy follows CONTEXT.md: "Workspace" everywhere; the UI calls a Project a "folder", code keeps `project`.
