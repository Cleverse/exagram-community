# Exagram

Exagram keeps the documents a team already writes — a doc, a spreadsheet, a deck, a saved conversation — in one place,
and lets an AI client read exactly the ones you have shared with it. Nothing is published without an Owner approving it,
every read is recorded, and what one person can read is decided in one place in the database rather than in each screen.

The words this codebase uses, and what each one means, are in `CONTEXT.md`. Read that first: they are the same words in
the schema, the API and the screens.

## What is in the box

| Piece       | Where               | What it does                                                                              |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------- |
| API         | `apps/api`          | The human API at `/v1`, the MCP endpoint at `/mcp`, the OAuth server at `/oauth`          |
| Worker      | `apps/worker`       | Extracts text from uploads and sweeps expired Links and uploads                           |
| Usercontent | `apps/usercontent`  | A second origin that serves HTML bodies under a strict CSP                                |
| Web         | `apps/web`          | The screens                                                                               |
| Core        | `packages/core`     | Contract, entities, repositories, the serve boundary                                      |
| Redactor    | `packages/redactor` | The redaction types and a detector that finds nothing; Community has no Finding detection |

## Running it

You need Docker, Node 24 and pnpm 11.

```bash
pnpm install
make local-db-up      # the shared Postgres
make local-db-init    # writes .env, creates and migrates this checkout's database
docker compose up
```

Then open http://localhost:5173 and sign up. The app, the API, the MCP endpoint and the OAuth server are all on that one
origin: the web app proxies `/v1`, `/oauth`, `/mcp` and `/.well-known` to the API so the session cookie and the OAuth
interaction cookie stay first-party. HTML bodies are the deliberate exception and are served from http://localhost:3002
instead, sandboxed.

## Connecting an AI client

Sign in, open **Connections**, and copy the server URL. Paste it into Claude.ai, Claude Desktop, ChatGPT or Cursor as a
custom connector. The client will send you back to Exagram to consent, where you choose what it may do; it then reaches
everything you reach. You can revoke it later on the same page, which stops tokens it already holds.

## Working on it

```bash
pnpm turbo typecheck      # every package
pnpm turbo lint
pnpm turbo test           # unit and component tests
pnpm --filter @exagram/api test:integration   # needs postgres up
pnpm --filter @exagram/web test:e2e           # needs the whole stack up
```

Conventions: TypeScript ESM everywhere, tabs, no semicolons, double quotes. Layering is one way,
`Router → Usecase → Datagateway → Repository → DB`, composed in `apps/api/src/index.ts`. Database access goes through
sqlc-generated queries in `packages/core/repository/postgres/gen`; regenerate with `mise run generate` after editing
`database/postgres/queries`.

Two rules are worth stating out loud, because the code depends on them and a well-meant change can break them quietly:

1. **Visibility is decided once.** Lists go through `exagram.visible_artifacts(p_kind, p_id)`; a single Artifact goes
   through `exagram.visible_artifact`. No TypeScript re-derives who may read what, and the web app never filters by
   access.
2. **A refusal says nothing.** An Artifact you may not read and an Artifact that does not exist give the same status and
   the same bytes. If you add an endpoint, keep that true.

## Local database access for AI tools

`make local-db-init` writes `dbhub.toml` (git-ignored) for this checkout's database; `dbhub.example.toml` shows its
shape. An MCP-aware client running the `dbhub` MCP server can use it for read-only SQL. Compose publishes the shared
Postgres on `127.0.0.1:25432` (override with `EXAGRAM_PG_PORT`); every git worktree gets its own database on it,
`exagram` in the main checkout and `exagram_<directory>_<path hash>` in a linked worktree (`make -s local-db-name`
prints it). `make local-db-up` starts the server. GUI clients (TablePlus etc.) connect to host `127.0.0.1`, port 25432,
user/password `exagram`, with the database name from `make -s local-db-name`.

## Running it on a server

[docs/self-host.md](docs/self-host.md) covers installing Exagram on your own infrastructure with Docker Compose,
Kubernetes or Cloudflare.

## License

Copyright (C) 2026 Cleverse.

Exagram is licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`); see [LICENSE](LICENSE).

To report a vulnerability, see [SECURITY.md](SECURITY.md).
