# Production readiness checks

Before HMBL OS is used for real work, and after every update, the readiness checks look at the live database and the settings and say, with evidence, whether they are safe (spec §30 Stage 9). The code is in `src/server/readiness/` and `src/lib/readiness.ts`.

Run them either way:

- **Administration → Readiness → Run checks now**, for owners and administrators of every entity (`organisation.configure` for all entities).
- **`pnpm readiness`** on the computer that runs HMBL OS. It prints the report and exits with 1 when anything fails, so it can stop an update script. `pnpm readiness --json` prints the stored run.

Every run is kept in `readiness_runs` with its results, who ran it, which database and which `APP_ENV`, and audited as `readiness.checked`. Runs are append-only: the database refuses changes and deletions, so the history is evidence of what was checked and when.

## Results

Each check passes, warns or fails, with a one-line summary and the facts behind it: counts, totals and the first few records at fault.

- **Pass**: checked, and nothing is wrong.
- **Warning**: it works, but a person should look before relying on it.
- **Fail**: something is wrong or unsafe. Fix it before using HMBL OS for real work.

Problems with configuration, demo data and backups fail only when `APP_ENV` is `production`. A development database is meant to have demo records and a throwaway secret, so there they are warnings. Production readiness is judged on the live database only.

## The checks

| Area                 | Check                                    | What it proves                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Financial invariants | Posted journals balance                  | Every posted journal has two or more lines, debits equal credits and its stored total, and each entity's trial balance agrees. Evidence: each entity's totals                                                            |
|                      | Documents and the ledger agree           | Every issued tax invoice and credit note, recorded receipt, payment and advance, approved bill and claim, and expense settlement has its posted journal; every voided one has had its journal reversed                   |
|                      | No duplicate postings                    | Every document journal carries an idempotency key, and the unique index that keeps one journal per key per entity is in place                                                                                            |
|                      | Control accounts agree with open items   | For each entity today: receivables equal the open invoices less money on account, payables the open bills less advances, staff advances and reimbursements payable the people's balances (the same reports Finance uses) |
| Audit history        | Database protections in place            | Every trigger the migrations install (append-only logs, frozen posted journals and issued documents, closed periods…) exists and is switched on. The list comes from the migration files, created minus dropped          |
|                      | Financial records are audited            | Every posted journal, issued invoice, approved bill, receipt, payment and closed period has the audit event written with it                                                                                              |
| Database migrations  | Migrations applied                       | Every migration in `prisma/migrations` is applied and finished, and none was changed after it was applied (checksums compared). Migrations the code doesn't know are a warning: the code may be older than the database  |
| Demo-data isolation  | No demo data in the live database        | In production: no row marked `isDemo` in any table, no user on `@demo.hmbl.test`, and the database isn't named like a development or test one (`_dev`, `_test`, `_ci`…)                                                  |
| Access               | Owners, two-factor and portal separation | There is an active owner; everyone in a role that requires two-factor has set it up (a warning: until then they hold no permissions); no portal user holds an internal role                                              |
| Configuration        | Safe configuration                       | `APP_ENV` is production, `BETTER_AUTH_SECRET` isn't a value published in this repository, `APP_URL` uses HTTPS when it isn't this computer, and the document folder can be written. Secrets are never shown              |
| Backups              | Recent backup                            | The newest `pnpm db:backup` dump of this database in `BACKUP_DIR` is under 26 hours old (a warning after that, a failure after 7 days in production) and not empty                                                       |

A check that can't run (a missing folder, a database error) fails with the error, and the others still run.

## When to run them

- Once before the first real use, on the live database, and keep that run.
- After every update, after `pnpm db:migrate:deploy` (see [running-locally.md](running-locally.md)).
- Any time something looks wrong in the books: the financial checks point at the records at fault.

## What they don't prove

The checks read the database and the settings. They don't test a restore, how fast pages are, or whether people have been given the right roles; those have their own steps in the production-readiness checklist. A pass means the invariants held when the run happened, not that they always will.
