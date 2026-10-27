# HMBL OS

The integrated operating system for HMBL Group: commercial, projects, production, crew, equipment, procurement, travel, finance and documents in one application.

Status: **Version 1 built, not yet in production use.** All nine stages of the specification are implemented and tested. Going live needs a few decisions and steps only HMBL can take; [docs/production-readiness.md](docs/production-readiness.md) lists them, with the evidence for everything else. Open policy decisions and their working defaults are in [docs/decisions.md](docs/decisions.md).

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

Demo accounts are `owner@`, `admin@`, `finance@`, `finance.in@` (Finance for the demo Indian entity only), `sales@`, `pm@` and `viewer@demo.hmbl.test`, all with the password `demo-password-2026`. They exist only in development and test databases.

Owner, Administrator and Finance demo users need a two-factor code. Add the demo key `JBGUETCEIVGU6VCPKRIFGRKDKJCVIRCPJZHVIVKTIVEU4UCSJ5CA` to any authenticator app (time-based, 6 digits) and use its codes; it is public and works only on seeded demo data. `new.finance@demo.hmbl.test` has no two-factor yet, to show the setup screen. To create a real user, see [docs/auth-and-permissions.md](docs/auth-and-permissions.md).

`GET /api/health` reports whether the app can reach the database.

## Checks

| Command                 | What it runs                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `pnpm lint`             | ESLint, zero warnings allowed                                    |
| `pnpm typecheck`        | Route type generation and `tsc`                                  |
| `pnpm format:check`     | Prettier                                                         |
| `pnpm test`             | Vitest unit and integration tests                                |
| `pnpm test:perf`        | Timed reads at about three years of volume, against a budget     |
| `pnpm test:e2e`         | Playwright against a production build                            |
| `pnpm check`            | lint, typecheck, format, unit and integration tests              |
| `pnpm db:drift`         | Fails if the schema and the migrations differ                    |
| `pnpm readiness`        | Production readiness checks against `DATABASE_URL`               |
| `pnpm db:restore-check` | Restores the latest backup into a scratch database and checks it |

Integration tests use `TEST_DATABASE_URL`, apply migrations to it and empty it before each test. Run `pnpm build` and `pnpm db:seed` before `pnpm test:e2e`; Playwright starts the built app on port 3100. If Chromium is already installed elsewhere, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its path instead of running `pnpm exec playwright install chromium`.

CI runs every check except the readiness and restore commands, migrations included, on each pull request against a fresh Postgres service. More in [docs/testing.md](docs/testing.md).

## Environments

Development and test use separate databases (`DATABASE_URL`, `TEST_DATABASE_URL`). Integration tests refuse to run against the development database. For now HMBL OS runs on one computer with its own `hmbl_live` database and daily backups; see [docs/running-locally.md](docs/running-locally.md) to install it and [docs/deployment.md](docs/deployment.md) to update and roll back. There is no cloud deployment configuration.

## Documentation

**Using and running HMBL OS**

- [User guide](docs/user-guide.md)
- [Running HMBL OS on your own computer](docs/running-locally.md)
- [Deploying, updating and rolling back](docs/deployment.md) (environment variables and migrations)
- [Backups and restore checks](docs/backups.md)
- [Production readiness checks](docs/readiness.md) and [checklist](docs/production-readiness.md)
- [Monitoring and error handling](docs/monitoring.md)
- [Decision register](docs/decisions.md) (known limitations and open decisions)

**How it is built**

- [Architecture and module boundaries](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Authentication and permissions](docs/auth-and-permissions.md)
- [Security](docs/security.md)
- [Audit log](docs/audit-log.md)
- [Design system and app shell](docs/design-system.md)
- [Testing guide](docs/testing.md) and [performance](docs/performance.md)

**Modules**

- Organisation and set-up: [organisation](docs/organisation.md), [master data](docs/master-data.md), [numbering](docs/numbering.md)
- Commercial: [CRM](docs/crm.md), [quotes and pricing](docs/commercial.md)
- Projects: [projects](docs/projects.md), [budget](docs/budget.md), [change control](docs/change-control.md), [schedule](docs/schedule.md), [resources](docs/resources.md), [closeout](docs/closeout.md)
- Operations: [crew](docs/crew.md), [equipment](docs/equipment.md), [procurement](docs/procurement.md), [travel](docs/travel.md), [logistics](docs/logistics.md), [show day](docs/production.md), [offline field app](docs/offline.md)
- Finance: [ledger](docs/ledger.md), [invoicing](docs/invoicing.md), [receipts](docs/receipts.md), [payables](docs/payables.md), [expenses](docs/expenses.md), [banking](docs/banking.md), [period close](docs/period-close.md), [financial reports](docs/financial-reports.md)
- Shared: [documents](docs/documents.md), [notifications and approvals](docs/notifications.md), [dashboards](docs/reporting.md)
- Outside HMBL: [portal access](docs/portal.md), [client portal](docs/client-portal.md), [vendor and freelancer portal](docs/vendor-portal.md)
- Data in and out: [integrations](docs/integrations.md), [imports](docs/imports.md), [data migration](docs/migration.md)
