#!/usr/bin/env bash
# Schedules HMBL OS's regular jobs on this computer with cron (macOS and Linux):
#   - a database and documents backup every day at 19:00
#   - the date-based reminders every day at 06:15
#   - a restore check of the newest backup on the 1st of each month at 19:30
# The computer must be switched on at those times; a missed run happens the
# next day. Running it again replaces the earlier entries. See docs/backups.md.
#
# Usage: pnpm live:schedule            add or update the jobs
#        pnpm live:schedule --remove   take them out again
set -euo pipefail

cd "$(dirname "$0")/.."
app="$(pwd)"
marker="# hmbl-os:$app"

if ! command -v crontab >/dev/null; then
  cat <<EOF
This computer has no cron (Windows?). Create three tasks in Task Scheduler
instead, each running bash.exe from Git for Windows, starting in:
  $app
  - daily 19:00:          bash scripts/backup-db.sh
  - daily 06:15:          bash -c "pnpm notifications:run"
  - monthly, 1st, 19:30:  bash -c "pnpm db:restore-check"
EOF
  exit 1
fi

current="$(crontab -l 2>/dev/null | grep -vF "$marker" || true)"

if [ "${1:-}" = "--remove" ]; then
  printf '%s\n' "$current" | sed '/^$/d' | crontab -
  echo "Removed the HMBL OS jobs from cron."
  exit 0
fi

grep -qE '^APP_ENV=production$' .env 2>/dev/null ||
  echo "Note: .env is not set to APP_ENV=production. Run pnpm live:setup first if this is the live computer."

# cron starts with a bare PATH; keep this shell's, so docker and pnpm are found.
run="cd \"$app\" && PATH=\"$PATH\""
mkdir -p backups
log="\"$app/backups\""
jobs="$(
  cat <<EOF
0 19 * * * $run bash scripts/backup-db.sh >> $log/backup.log 2>&1 $marker
15 6 * * * $run pnpm --silent notifications:run >> $log/notifications.log 2>&1 $marker
30 19 1 * * $run pnpm --silent db:restore-check >> $log/restore-check.log 2>&1 $marker
EOF
)"

printf '%s\n%s\n' "$current" "$jobs" | sed '/^$/d' | crontab -
echo "Scheduled: backup daily 19:00, reminders daily 06:15, restore check monthly."
echo "Logs go to backups/*.log. See them with: crontab -l"
if [ "$(uname)" = "Darwin" ]; then
  cat <<EOF

On a Mac, cron needs permission to read this folder: System Settings →
Privacy & Security → Full Disk Access → add /usr/sbin/cron. Check tomorrow
that backups/backup.log has a new "Backed up" line.
EOF
fi
