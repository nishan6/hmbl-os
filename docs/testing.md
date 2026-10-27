# Testing guide

What the tests cover, how to run them, and the rules for adding to them.

## The suites

| Suite       | Where               | Runs with        | What it is for                                                                                                                                                        |
| ----------- | ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `tests/unit`        | `pnpm test`      | Pure rules with no database: money, tax, pricing, lifecycles, numbering patterns, design tokens, and the server-boundary check that every page and action has a guard |
| Integration | `tests/integration` | `pnpm test`      | Services against a real Postgres: permissions, transactions, audit events, postings, database triggers and the readiness checks                                       |
| End to end  | `tests/e2e`         | `pnpm test:e2e`  | The built app in Chromium: workflows people do, the access sweep over every route, accessibility (axe, WCAG 2.2 AA, light and dark)                                   |
| Performance | `tests/perf`        | `pnpm test:perf` | Times the busiest reads at about three years of volume, against a budget ([performance.md](performance.md))                                                           |

CI runs all four, plus lint, types, formatting, migrations and a schema drift check, on every pull request.

## Running them

```bash
docker compose up -d                 # Postgres with hmbl_dev and hmbl_test
pnpm test                            # unit and integration
pnpm test -- tests/integration/ledger.test.ts   # one file
pnpm build && pnpm db:seed           # once, before the browser tests
pnpm test:e2e                        # starts the built app on port 3100
pnpm exec playwright test tests/e2e/users.spec.ts --workers=1
pnpm test:perf                       # PERF_SCALE=4 for four times the volume
pnpm check                           # lint, types, formatting, unit and integration
```

- Integration and performance tests use `TEST_DATABASE_URL`, apply the migrations to it, and **empty every table before each test**. They refuse to run against `DATABASE_URL`.
- Browser tests sign in as the demo users from `prisma/seed.ts` (passwords and the demo authenticator key are in the README). They run against `DATABASE_URL`, so use the development database, never the live one.
- Sign-in is rate limited except when `APP_ENV=test`; run the browser tests with it set, as CI does.
- The restore check test needs `pg_dump` and `pg_restore` of the same major version as the server ([backups.md](backups.md)).

## Rules

- **Never weaken or skip a test to get green.** Find the cause. A test that is wrong is fixed with the reason in the commit.
- Every write a service makes is tested for its permission check (someone without it is refused, someone scoped to another legal entity is refused) and for its audit event.
- Money is checked to the minor unit, and every posting is checked to balance.
- Rules the database enforces (append-only records, posted documents that can't change) are tested by trying to break them, including with triggers bypassed where the test proves a readiness check would catch it.
- New pages are covered by the access sweep automatically. A new public page or action must be added, with its reason, to the lists in `tests/unit/server-boundaries.test.ts` and `tests/e2e/access-sweep.spec.ts`.
- New screens that people fill in get an end-to-end test of the main path, and an entry in `tests/e2e/accessibility.spec.ts`.

## Demo data

`pnpm db:seed` fills a development database with clearly marked demo records (`isDemo: true`, names starting "Demo", users at `@demo.hmbl.test`). It is the only place demo records are created, and it refuses to run when `APP_ENV` is `production`. The readiness checks fail if any demo record or demo user reaches the live database.
