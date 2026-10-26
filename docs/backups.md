# Backups and restore checks

A backup is only useful if it restores. HMBL OS takes backups with `pnpm db:backup` and proves them with `pnpm db:restore-check` (spec §32 H). Setting them up on the computer that runs HMBL OS is in [running-locally.md](running-locally.md).

## Taking backups

`pnpm db:backup` (`scripts/backup-db.sh`) writes `<database>-<date>-<time>.dump` to `BACKUP_DIR` (default `backups`) in Postgres's compressed custom format, deletes dumps older than `BACKUP_KEEP_DAYS` (30), and copies new uploaded documents from `STORAGE_DIR` into `BACKUP_DIR/storage`. Documents are never changed once written, so copying new ones is enough.

The readiness checks ([readiness.md](readiness.md)) warn when the newest backup is over 26 hours old and fail in production after 7 days.

## Proving a backup restores

```bash
pnpm db:restore-check                                        # the newest backup
pnpm db:restore-check backups/hmbl_live-20261027-190000.dump # a particular one
pnpm db:restore-check --keep                                 # leave the copy to look at
```

It:

1. Creates an empty scratch database, `<database>_restore_check`, on the same Postgres server. The live database is never written to, apart from storing the result.
2. Restores the dump into it with `pg_restore --exit-on-error`, so a damaged or cut-off dump fails at once. On HMBL's computer Postgres runs in Docker and the container's `pg_restore` is used; elsewhere the one on the PATH. `PG_TOOLS=docker` or `PG_TOOLS=local` forces one. Tools on the PATH must be the same major version as the server: a newer `pg_dump` writes settings an older server rejects, and the check fails with "unrecognized configuration parameter".
3. Checks the copy holds the data (users, audit history up to before the backup was taken, journals, invoices, projects).
4. Runs the readiness integrity checks against the copy: journals balance, documents and the ledger agree, no duplicate postings, control accounts agree, protections in place, records audited, migrations applied.
5. Looks for every stored document and expense receipt the copy lists in `BACKUP_DIR/storage`, at the right size.
6. Keeps the result in `restore_checks` (append-only), audits it as `backup.restore_checked`, drops the scratch database, and exits with 1 if anything failed.

Owners and administrators see the latest results under **Administration → Readiness**. The readiness checks warn when no backup has been test-restored in 30 days, and fail when the latest restore check failed.

Run it monthly, after changing how backups are taken, and before any risky change such as the financial migration.

## Restoring for real

Stop HMBL OS first. Restoring replaces everything in the database with the backup.

```bash
docker compose exec -T postgres pg_restore -U hmbl --clean --if-exists -d hmbl_live < backups/hmbl_live-YYYYMMDD-HHMMSS.dump
cp -Rn backups/storage/. storage/
pnpm db:migrate:deploy   # if the backup is from before the code's latest migration
pnpm readiness
```

Work entered after the backup was taken is lost and has to be entered again. The audit log in the restored database ends at the backup time, which shows where to start.

## What this doesn't cover

- A backup on the same disk doesn't survive that disk failing or the computer being lost. Copy `BACKUP_DIR` to an external drive or a cloud folder at least weekly.
- The restore check proves the latest dump restores on this computer. It doesn't prove the off-site copy is current; check that by hand.
