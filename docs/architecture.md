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
- **Rendering**: Cache Components is off. Every screen depends on the signed-in user and their permissions, so pages render per request.

## What exists

| Area                                       | State                                                          |
| ------------------------------------------ | -------------------------------------------------------------- |
| Scaffold, CI, local Postgres, env template | Built                                                          |
| Authentication, roles and permissions      | Built — see [auth-and-permissions.md](auth-and-permissions.md) |
