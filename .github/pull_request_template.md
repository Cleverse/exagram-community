## What and why

<!-- What this changes, and the problem it solves. Link the issue it closes, if any. -->

## How it was tested

<!-- What you ran or clicked through, and what you saw. -->

## Checks

- [ ] `pnpm typecheck --continue && pnpm lint --continue && pnpm test --continue`
- [ ] `pnpm test:integration --continue`, if this touches the database, a repository, a usecase or an MCP tool
- [ ] A migration, if any, has a working `down` (`make local-migrate-roundtrip`) and the next free number
- [ ] User-facing copy uses the words in CONTEXT.md
