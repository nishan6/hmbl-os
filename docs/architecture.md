# Architecture

HMBL OS is one modular TypeScript application on PostgreSQL. Modules are separated by folder and by service functions, not by network boundaries.

## Layers

1. **UI** (`src/app`, `src/components`): React Server Components and client components. Never imports Prisma.
2. **Server actions and route handlers** (`src/app/**/actions.ts`, `src/app/api`): validate input with Zod, resolve the session, call a service.
3. **Services** (`src/server/<module>`): business rules, permission checks, transactions, audit events.
4. **Data** (`src/server/db.ts`, `prisma/`): Prisma client over the `pg` driver adapter. Migrations in `prisma/migrations`.

## Cross-cutting

- **Configuration**: `src/lib/env.ts` validates environment variables at first use and never prints their values.
- **Logging**: `src/lib/logger.ts` writes JSON lines and redacts keys that look like secrets.
- **Validation**: `src/lib/validation.ts` (codes, ISO country and currency, IANA time zones) and `parseInput()` in `src/lib/parse.ts`, which turns Zod failures into a `ValidationError` with field messages.
- **Migrations**: CI fails if `prisma/schema.prisma` and the migrations disagree (`pnpm db:drift`). A few invariants that Prisma can't express, such as CHECK constraints, are hand-written in the migration SQL.
- **Errors**: `src/lib/errors.ts` defines `AppError` subclasses (unauthenticated, forbidden, not found, validation, conflict) whose messages are safe to show users.
- **UI**: design tokens in `src/app/globals.css`, primitives in `src/components/ui`, the shell in `src/components/shell`. See [design-system.md](design-system.md).
- **Rendering**: Cache Components is off. Every screen depends on the signed-in user and their permissions, so pages render per request.

## What exists

| Area                                         | State                                                          |
| -------------------------------------------- | -------------------------------------------------------------- |
| Scaffold, CI, local Postgres, env template   | Built                                                          |
| Authentication, roles and permissions        | Built — see [auth-and-permissions.md](auth-and-permissions.md) |
| Two-factor sign-in                           | Built — see [auth-and-permissions.md](auth-and-permissions.md) |
| Running locally with backups                 | Built — see [running-locally.md](running-locally.md)           |
| Legal entities and organisation structure    | Built — see [organisation.md](organisation.md)                 |
| Audit log                                    | Built — see [audit-log.md](audit-log.md)                       |
| Numbering schemes                            | Built — see [numbering.md](numbering.md)                       |
| Design system and app shell                  | Built — see [design-system.md](design-system.md)               |
| Master data: tax rates, payment terms, units | Built — see [master-data.md](master-data.md)                   |
| CRM: clients, contacts, pipeline             | Built — see [crm.md](crm.md)                                   |
| Estimates and pricing                        | Built — see [commercial.md](commercial.md)                     |
| Quote approvals, issuing and acceptance      | Built — see [commercial.md](commercial.md)                     |
| Projects: lifecycle, types and details       | Built — see [projects.md](projects.md)                         |
| Project budgets, costs and forecasts         | Built — see [budget.md](budget.md)                             |
| Change control                               | Built — see [change-control.md](change-control.md)             |
| Project schedule and milestones              | Built — see [schedule.md](schedule.md)                         |
| Crew and equipment planning                  | Built — see [resources.md](resources.md)                       |
| Documents on records and the library         | Built — see [documents.md](documents.md)                       |
| Project closeout                             | Built — see [closeout.md](closeout.md)                         |
| Ledger, chart of accounts and journals       | Built — see [ledger.md](ledger.md)                             |
| Invoices and credit notes                    | Built — see [invoicing.md](invoicing.md)                       |
| Receipts, bank accounts and receivables      | Built — see [receipts.md](receipts.md)                         |
| Vendors, bills, payments and payables        | Built — see [payables.md](payables.md)                         |
| Expense claims and advances                  | Built — see [expenses.md](expenses.md)                         |
| Bank statements and reconciliation           | Built — see [banking.md](banking.md)                           |
| Financial reports and finance dashboard      | Built — see [financial-reports.md](financial-reports.md)       |
| Period close                                 | Built — see [period-close.md](period-close.md)                 |
| Crew and freelancers                         | Built — see [crew.md](crew.md)                                 |
| Equipment inventory and maintenance          | Built — see [equipment.md](equipment.md)                       |
| Procurement and purchase orders              | Built — see [procurement.md](procurement.md)                   |
| Travel and accommodation                     | Built — see [travel.md](travel.md)                             |
| Logistics: freight, equipment, vehicles      | Built — see [logistics.md](logistics.md)                       |
| Notifications and approvals inbox            | Built — see [notifications.md](notifications.md)               |
| Portal accounts, invitations and access      | Built — see [portal.md](portal.md)                             |
| Client portal                                | Built — see [client-portal.md](client-portal.md)               |
| Vendor and freelancer portal                 | Built — see [vendor-portal.md](vendor-portal.md)               |
| Production workspace and show day            | Built — see [production.md](production.md)                     |
| Field app and offline show packs             | Built — see [offline.md](offline.md)                           |
| Other business modules                       | Not started; listed in the navigation as "Planned"             |
