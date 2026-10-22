<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## HMBL OS conventions

- Read `docs/architecture.md` before changing module boundaries, and `docs/decisions.md` before touching a business rule.
- No AI features, SDKs or infrastructure in Version 1.
- Domain logic lives in `src/server/<module>/`. UI never queries the database directly.
- Every write checks permissions on the server and records an audit event.
- Money is integer minor units plus an ISO 4217 currency code. Never floats.
- Schema changes go through a Prisma migration; never edit an applied migration. `prisma migrate dev` is interactive; without a terminal, apply existing migrations with `pnpm db:migrate:deploy`, write the new one from `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, then confirm `pnpm db:drift` passes.
- Records that belong to a legal entity carry `legalEntityId` and are checked with that scope (`authorize(actor, perm, { legalEntityId })`, `entityFilter`).
- Demo records set `isDemo: true` and are created only by `prisma/seed.ts`.
- Run `pnpm check` before pushing. Do not weaken or skip a test to get green.
