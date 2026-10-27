# Deploying, updating and rolling back

How HMBL OS goes live, how a new version goes on, and how to undo a bad one. HMBL OS currently runs on one computer (Hosting in [decisions.md](decisions.md)); the first installation is in [running-locally.md](running-locally.md). This page is the procedure for every release after that.

## Environment variables

Set in `.env` next to the code. `src/lib/env.ts` checks them at start and refuses to run with a bad one, without printing any values.

| Variable             | Live value                                                     | Notes                                                                                                                            |
| -------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`            | `production`                                                   | The seed refuses to run; the readiness checks fail on demo data, a published secret or missing backups                           |
| `DATABASE_URL`       | `postgresql://hmbl:…@localhost:5432/hmbl_live`                 | Never a database whose name ends in `_dev`, `_test` or `_demo`: the readiness checks fail on it                                  |
| `APP_URL`            | `http://localhost:3000`, or the `https://` address on a server | Used in invitation and password links. Anything reached over a network must be HTTPS                                             |
| `BETTER_AUTH_SECRET` | 32+ random characters (`openssl rand -base64 32`)              | Signs sessions and encrypts two-factor secrets. Keep it in a password manager; losing it means everyone sets up two-factor again |
| `LOG_LEVEL`          | `info`                                                         | `debug` writes more than a live system needs                                                                                     |
| `STORAGE_DIR`        | `storage`                                                      | Uploaded documents. Back it up with the database                                                                                 |
| `BACKUP_DIR`         | `backups`                                                      | Where `pnpm db:backup` writes and the readiness and restore checks look                                                          |
| `BACKUP_KEEP_DAYS`   | `30`                                                           | Read by `scripts/backup-db.sh` only                                                                                              |
| `PG_TOOLS`           | unset                                                          | `docker` or `local` forces where `pg_restore` runs for restore checks ([backups.md](backups.md))                                 |
| `TEST_DATABASE_URL`  | unset                                                          | Development only: the database the automated tests empty and refill                                                              |

## Before every update

1. **The change is merged into `main` with CI green.** CI runs lint, types, formatting, every unit and integration test, the performance budget, a production build and the browser tests against a fresh database. Never update the live computer from a branch.
2. **Nobody is in the middle of something.** Updating restarts HMBL OS; unsaved forms are lost.
3. **Note the version you are on**, so you can come back to it:

   ```bash
   git rev-parse --short HEAD    # e.g. 586fa26; write it down
   ```

4. **Take a backup and keep it aside:**

   ```bash
   pnpm db:backup
   ls -t backups/*.dump | head -1   # the backup to restore if the update goes wrong
   ```

## Updating

```bash
# stop HMBL OS (Ctrl+C in its terminal)
git pull
pnpm install --frozen-lockfile
pnpm db:migrate:deploy        # applies new database changes, if any
pnpm build
pnpm readiness                # stop here if anything says FAIL
pnpm start
```

Then check it by hand: <http://localhost:3000/api/health> answers `"status":"ok"`, you can sign in, and the home page and one finance page open. **Administration → Readiness** shows the run you just made.

`pnpm db:migrate:deploy` lists the migrations it applied. If it applied none, rolling back needs no restore.

## Rolling back

Choose by how far the update got.

**The build or the readiness checks failed, and no migration was applied.** Nothing in the database changed:

```bash
git checkout <the version you noted>
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

**Migrations were applied.** Database changes only go forward; there are no "down" migrations, because undoing one by hand risks the books. Go back to the backup taken just before the update:

```bash
# stop HMBL OS
docker compose exec -T postgres pg_restore -U hmbl --clean --if-exists -d hmbl_live < backups/<the backup you kept>.dump
git checkout <the version you noted>
pnpm install --frozen-lockfile
pnpm build
pnpm readiness
pnpm start
```

Anything entered between the update and the rollback is lost, because the backup is from before it. The audit log of the database you are leaving shows what was done in that time (**Administration → Audit log** lists the newest first; read back to the update time); take a second backup before restoring if that work needs re-entering.

When the fix is ready, go back to `main` with `git checkout main` and update again as above.

That the restore itself works is proven monthly by `pnpm db:restore-check` ([backups.md](backups.md)).

## Moving to a server

When the team needs HMBL OS from more than one computer (Hosting in [decisions.md](decisions.md)), the same steps run on a small Linux server. **This has not been done or tested yet.** What changes:

- HTTPS in front of HMBL OS, for example Caddy, which gets and renews a certificate by itself. `APP_URL` becomes the `https://` address; secure cookies switch on automatically.
- `pnpm start` runs under a service manager (systemd) so it restarts after a crash or a reboot. Backups and reminders run from the server's cron.
- Postgres listens only on the server itself; the firewall opens 443 (and 22 for administration) and nothing else.
- `BACKUP_DIR` is copied off the server every day, to storage in another place.
- A new `BETTER_AUTH_SECRET` is generated for the server; everyone sets up two-factor again, or the old secret is moved over with the database.

The readiness checks already fail when `APP_URL` is reached over a network without HTTPS.
