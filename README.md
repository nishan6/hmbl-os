# HMBL OS

The integrated operating system for HMBL Group: commercial, projects, production, crew, equipment, procurement, travel, finance and documents in one application.

Status: **Stage 1, foundations.** No business modules are built yet. See [docs/architecture.md](docs/architecture.md) for what exists and [docs/decisions.md](docs/decisions.md) for open policy decisions.

## Stack

Next.js (App Router) and TypeScript, PostgreSQL with Prisma, Better Auth, Zod, Tailwind CSS with Radix primitives, pg-boss, Vitest and Playwright, pnpm, GitHub Actions. Version 1 contains no AI features.

## Local setup

Requirements: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env          # local-only values, never committed
docker compose up -d          # Postgres 16 with hmbl_dev and hmbl_test databases
pnpm install                  # also generates the Prisma client
pnpm db:migrate:dev           # apply migrations to hmbl_dev
pnpm db:seed                  # default roles and DEMO users (refuses in production)
pnpm dev                      # http://localhost:3000
```

Demo accounts are `owner@`, `admin@`, `finance@`, `finance.in@` (Finance for the demo Indian entity only), `sales@`, `pm@` and `viewer@demo.hmbl.test`, all with the password `demo-password-2026`. They exist only in development and test databases. To create a real user, see [docs/auth-and-permissions.md](docs/auth-and-permissions.md).

`GET /api/health` reports whether the app can reach the database.

## Checks

| Command             | What it runs                           |
| ------------------- | -------------------------------------- |
| `pnpm lint`         | ESLint, zero warnings allowed          |
| `pnpm typecheck`    | Route type generation and `tsc`        |
| `pnpm format:check` | Prettier                               |
| `pnpm test`         | Vitest unit and integration tests      |
| `pnpm test:e2e`     | Playwright against a production build  |
| `pnpm check`        | lint, typecheck, format and unit tests |

Integration tests use `TEST_DATABASE_URL`, apply migrations to it and empty it before each test. Run `pnpm build` and `pnpm db:seed` before `pnpm test:e2e`; Playwright starts the built app on port 3100. If Chromium is already installed elsewhere, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path instead of running `pnpm exec playwright install chromium`.

CI runs every check, migrations included, on each pull request against a fresh Postgres service.

## Environments

Development and test use separate databases (`DATABASE_URL`, `TEST_DATABASE_URL`). Integration tests refuse to run against the development database. Hosting is not chosen yet, so the repository has no deployment configuration.

## Documentation

- [Architecture](docs/architecture.md)
- [Authentication and permissions](docs/auth-and-permissions.md)
- [Organisation structure](docs/organisation.md)
- [Audit log](docs/audit-log.md)
- [Decision register](docs/decisions.md)
