# Security and access checks

How HMBL OS keeps people to what they may see and do, and the tests that prove it (spec §30 Stage 9, §32 E). Sign-in, roles and permissions themselves are in [auth-and-permissions.md](auth-and-permissions.md); portal accounts in [portal.md](portal.md).

## Where access is decided

Every decision is made on the server. Pages, server actions and API routes call one of the guards (`requireActor`, `requirePermission`, `requirePortalActor` and their variants, or `loadFinancePage`), and the domain services in `src/server/<module>/` check the permission again with `authorize(actor, perm, { legalEntityId })`, so a missing check in a page is caught by the service. Hiding a button is never the only protection.

## What the tests prove

| Test                                                                                  | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/server-boundaries.test.ts`                                                | Every page, every exported server action and every API route calls a guard, apart from a short list of public ones with the reason written next to each (sign-in, accepting an invitation, the health check, calendar feeds that use their own secret link, Better Auth's own routes, and the theme preference). Pages and components never import the database client. A new page or action without a guard fails `pnpm test`. |
| `tests/e2e/access-sweep.spec.ts`                                                      | Every page and API route found in `src/app` (167 pages and 14 API routes when written) is visited for real: signed out, each page sends you to sign in and each API refuses; a client portal user is refused every internal page and API; a viewer can't open portal pages, administration, or forms that create records. New routes are swept without editing the test.                                                        |
| Portal tests (`client-portal`, `vendor-portal`, `portal-access`, integration and e2e) | A client portal user sees only their own organisation's projects, documents and invoices; a vendor or freelancer sees only their own orders, bills and bookings.                                                                                                                                                                                                                                                                |
| Integration tests per module                                                          | Each service refuses actors without the permission, and actors scoped to one legal entity can't read or change another entity's records.                                                                                                                                                                                                                                                                                        |
| `pnpm readiness`, area access                                                         | In the live database: there is an active owner, everyone who must use two-factor has set it up, and no portal user holds an internal role.                                                                                                                                                                                                                                                                                      |

## Settings that protect sessions

- Accounts are created by an administrator or an invitation; nobody can sign themselves up. Passwords are at least 12 characters.
- Sessions last 12 hours and are renewed hourly while in use.
- Sign-in is limited to 10 attempts a minute, and other auth requests to 100 a minute, counted in the database so a restart doesn't reset them.
- Cookies are marked secure when `APP_URL` is HTTPS. The readiness checks fail in production when HMBL OS is reached over the network without HTTPS, or when the sign-in secret is one published in the repository.
- Two-factor is required for owners, administrators and finance roles before they can do anything (see [auth-and-permissions.md](auth-and-permissions.md)).

## Response headers

Every response carries (set in `next.config.ts`, checked by the access sweep):

| Header                       | Value                                                                            | Why                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `X-Content-Type-Options`     | `nosniff`                                                                        | Browsers don't guess file types, so an upload can't run as a page.    |
| `X-Frame-Options`            | `DENY`                                                                           | HMBL OS can't be shown inside another site to trick clicks.           |
| `Content-Security-Policy`    | `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` | The same for modern browsers; forms only post to HMBL OS; no plugins. |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                | Links out don't carry record addresses.                               |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=()`                                       | The pages can't ask for these.                                        |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                    | Other sites opened from HMBL OS can't reach back into it.             |

A full script policy (`script-src` with nonces) is not set: it would make every page render per request with a nonce for little gain on a private, sign-in-only app. Revisit it if HMBL OS is ever put on the public internet.

## Dependencies

`pnpm audit --prod` reported no known vulnerabilities on 2026-10-26. Run it before each update of the live computer; a high or critical finding in a package HMBL OS uses blocks the update.

## What this doesn't cover

- No outside penetration test has been done. The checks above prove the rules the code is meant to follow; they don't prove there is no flaw in Next.js, Better Auth or Postgres themselves.
- The computer that runs HMBL OS needs its own protection: disk encryption, an operating system that gets updates, and a screen lock. HMBL OS can't check these.
