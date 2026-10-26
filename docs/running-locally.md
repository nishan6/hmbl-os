# Running HMBL OS on your own computer

This is how to use HMBL OS for real work on one computer, at no cost. It's different from development: it uses its own database (`hmbl_live`), a production build, and no demo data.

What to know first:

- Only people on this computer can use it, and only while it is switched on.
- Your data lives on this computer. **Back it up every day and copy the backups somewhere else**, as described below.
- When you are ready for your team to use it, the same setup moves to a small rented server (see `docs/decisions.md`, Hosting).

## 1. Install once

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) (runs the database).
2. [Node.js 22 LTS](https://nodejs.org/).
3. pnpm: run `corepack enable` in a terminal.
4. Git, then get the code:

   ```bash
   git clone https://github.com/nishan6/hmbl-os.git
   cd hmbl-os
   pnpm install
   ```

## 2. Start the database

```bash
docker compose up -d
docker compose exec postgres createdb -U hmbl hmbl_live
```

The database only accepts connections from this computer. Its data stays in a Docker volume when Docker restarts.

## 3. Configure

```bash
cp .env.example .env
openssl rand -base64 32   # copy the output for BETTER_AUTH_SECRET
```

Edit `.env`:

| Setting              | Value                                             |
| -------------------- | ------------------------------------------------- |
| `APP_ENV`            | `production`                                      |
| `DATABASE_URL`       | `postgresql://hmbl:hmbl@localhost:5432/hmbl_live` |
| `APP_URL`            | `http://localhost:3000`                           |
| `BETTER_AUTH_SECRET` | the value you just generated                      |

**Save `BETTER_AUTH_SECRET` in your password manager.** It encrypts everyone's two-factor secrets. If it is lost, every user has to set up two-factor again; if it leaks, change it the same way.

## 4. Build and create the first owner

```bash
pnpm db:migrate:deploy
pnpm build
read -s HMBL_NEW_USER_PASSWORD && export HMBL_NEW_USER_PASSWORD   # type a password of 12+ characters
pnpm user:create --name "Your Name" --email you@example.com --role owner
unset HMBL_NEW_USER_PASSWORD
```

## 5. Start it

```bash
pnpm start
```

Open <http://localhost:3000> and sign in. Because Owner is a role that requires two-factor, you'll be asked to set it up with an authenticator app first. Then go to **Administration → Organisation → New legal entity** and add HMBL Entertainment with its registered name, country, currency and tax registrations.

To stop it, press `Ctrl+C` in that terminal. Start it again with `pnpm start`.

## Check it is ready

```bash
pnpm db:backup
pnpm readiness
```

The readiness checks look at the books, the audit log, migrations, demo data, settings and backups, and keep the result as evidence (see [readiness.md](readiness.md)). Fix anything marked FAIL before entering real work. Owners and administrators can also run them from **Administration → Readiness**.

## 6. Back up every day

```bash
pnpm db:backup
```

This writes `backups/hmbl_live-<date>-<time>.dump` and deletes backups older than 30 days (change with `BACKUP_KEEP_DAYS`).

It also copies any new uploaded documents from the `storage` folder (`STORAGE_DIR`) into `backups/storage`. Documents are never deleted, and there is no size limit, so keep an eye on free disk space if you store large video files.

Run it automatically:

- **macOS or Linux**: run `crontab -e` and add (with your own path):

  ```
  0 19 * * * cd /path/to/hmbl-os && /usr/bin/env bash scripts/backup-db.sh >> backups/backup.log 2>&1
  ```

- **Windows**: in Task Scheduler, create a daily task that runs `bash.exe` (from Git for Windows) with the argument `scripts/backup-db.sh` and starts in the `hmbl-os` folder.

A backup on the same disk doesn't survive that disk failing or the laptop being lost. **Copy the `backups` folder to an external drive or a cloud folder** (Google Drive, OneDrive, iCloud) at least weekly. The simplest way is to point your sync app (or a scheduled copy) at the `backups` folder.

### Restore a backup

Restoring replaces everything in the database with the backup. Stop the app first.

```bash
docker compose exec -T postgres pg_restore -U hmbl --clean --if-exists -d hmbl_live < backups/hmbl_live-YYYYMMDD-HHMMSS.dump
```

Then copy the documents back: `cp -Rn backups/storage/. storage/`.

Try a restore once into a scratch database (`createdb -U hmbl hmbl_restore_test`, then restore with `-d hmbl_restore_test`) so you know it works before you need it.

## Updating to a new version

```bash
pnpm db:backup          # always back up first
git pull
pnpm install
pnpm db:migrate:deploy
pnpm build
pnpm readiness          # stop here if anything fails
pnpm start
```
