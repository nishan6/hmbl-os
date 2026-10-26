# Monitoring and error handling

HMBL OS runs on one computer with no outside monitoring service, so it watches itself and shows what it finds under **Administration → Readiness** (spec §26). Nothing is sent anywhere.

## Server errors

- When a page, action or route fails, the person sees "Something went wrong. Nothing was saved." with a **reference** (Next.js's error digest). They never see the error itself, a stack trace or a secret.
- `src/instrumentation.ts` records every server error in `app_errors`: the time, the reference, the method, the route's file path (for example `/(app)/projects/[id]/page`, never the address with its ids or query), the error's name and the first 300 characters of its message. Redirects and "not found" are not errors and are not recorded.
- The full error also goes to the log as JSON, with secrets redacted ([logger](../src/lib/logger.ts)).
- Owners and administrators see the latest 20 under Administration → Readiness, so the reference someone quotes can be looked up. Records older than 90 days are deleted.
- The readiness check "No server errors in the last day" warns when there were any.

## Scheduled jobs

Each run of `pnpm notifications:run` is recorded in `job_runs` with its outcome and counts, or its error. The readiness check "Scheduled jobs run" warns when a job has never run or hasn't succeeded for 26 hours, and fails when its last run failed. A failed run is never retried silently: the error is kept and the next scheduled run tries again.

Backups are checked by the age of the newest dump instead, since `pnpm db:backup` is a shell script ([backups.md](backups.md)).

## Health

`GET /api/health` answers `{"status":"ok","database":"ok"}`, or 503 with `degraded` when the database can't be reached. It needs no sign-in and says nothing else.

## Watching it day to day

On the computer that runs HMBL OS, schedule (see [running-locally.md](running-locally.md)):

| When          | Command                  |
| ------------- | ------------------------ |
| Daily, 06:15  | `pnpm notifications:run` |
| Daily, 19:00  | `pnpm db:backup`         |
| Monthly       | `pnpm db:restore-check`  |
| After updates | `pnpm readiness`         |

Then glance at Administration → Readiness once a week.
