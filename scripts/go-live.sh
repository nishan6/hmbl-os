#!/usr/bin/env bash
# Sets up the live HMBL OS installation on this computer, in one go:
# database, .env, migrations, production build, the first owner, a first
# backup and the readiness checks. Safe to run again: steps already done are
# skipped. See docs/running-locally.md.
#
# Usage: pnpm live:setup        (or: bash scripts/go-live.sh)
set -euo pipefail

cd "$(dirname "$0")/.."
database="hmbl_live"

step() { printf '\n==> %s\n' "$*"; }
fail() {
  printf 'Stopped: %s\n' "$*" >&2
  exit 1
}

step "Checking the tools are installed"
command -v docker >/dev/null || fail "Docker is not installed. Install Docker Desktop and start it."
docker info >/dev/null 2>&1 || fail "Docker is installed but not running. Start Docker Desktop and try again."
command -v node >/dev/null || fail "Node.js is not installed. Install Node.js 22 LTS."
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" -ge 22 ] || fail "Node.js $node_major is too old. Install Node.js 22 LTS."
command -v pnpm >/dev/null || fail "pnpm is not installed. Run: corepack enable"
command -v openssl >/dev/null || fail "openssl is not installed."
echo "Docker, Node.js $(node -v), pnpm $(pnpm -v) and openssl found."

step "Starting the database"
docker compose up -d --wait postgres </dev/null
if docker compose exec -T postgres psql -U hmbl -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$database'" </dev/null | grep -q 1; then
  echo "Database $database already exists; keeping it."
else
  docker compose exec -T postgres createdb -U hmbl "$database" </dev/null
  echo "Created database $database."
fi

step "Writing the live settings (.env)"
if [ -f .env ] && grep -qE '^APP_ENV=production$' .env; then
  echo ".env is already set up for production; keeping it."
else
  if [ -f .env ]; then
    mv .env .env.development
    echo "Your development .env is kept as .env.development."
  fi
  secret="$(openssl rand -base64 32)"
  sed \
    -e 's/^APP_ENV=.*/APP_ENV=production/' \
    -e "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://hmbl:hmbl@localhost:5432/$database#" \
    -e '/^TEST_DATABASE_URL=/d' \
    -e '/^# Separate database for automated tests/d' \
    -e "s#^BETTER_AUTH_SECRET=.*#BETTER_AUTH_SECRET=$secret#" \
    .env.example >.env
  chmod 600 .env
  cat <<EOF

  IMPORTANT: save this secret in your password manager now, as
  "HMBL OS BETTER_AUTH_SECRET". It encrypts everyone's two-factor set-up.
  If it is lost, every user has to set up two-factor again.

      $secret

EOF
  read -r -p "Press Enter once it is saved. " _
  echo
  echo "Backups should also be copied off this computer. Give a folder your"
  echo "cloud sync app keeps (e.g. ~/Google Drive/HMBL backups) or an external"
  read -r -p "drive, or press Enter to skip for now: " copy_dir
  copy_dir="${copy_dir/#\~/$HOME}"
  if [ -n "$copy_dir" ]; then
    mkdir -p "$copy_dir"
    sed -i.bak "s#^BACKUP_COPY_DIR=.*#BACKUP_COPY_DIR=$copy_dir#" .env && rm -f .env.bak
    echo "Backups will also be copied to $copy_dir"
  fi
fi

step "Installing, updating the database and building"
pnpm install --frozen-lockfile
pnpm db:migrate:deploy
pnpm build

step "Creating the first owner"
users="$(docker compose exec -T postgres psql -U hmbl -d "$database" -tAc 'SELECT count(*) FROM users' </dev/null | tr -d '[:space:]')"
if [ "$users" != "0" ]; then
  echo "There are already $users users; skipping. Add more in Administration → Users."
else
  read -r -p "Your full name: " owner_name
  read -r -p "Your email address: " owner_email
  while true; do
    read -r -s -p "Choose a password (12+ characters): " HMBL_NEW_USER_PASSWORD
    echo
    read -r -s -p "Type it again: " again
    echo
    if [ "${#HMBL_NEW_USER_PASSWORD}" -lt 12 ]; then
      echo "That is shorter than 12 characters. Try again."
    elif [ "$HMBL_NEW_USER_PASSWORD" != "$again" ]; then
      echo "The two don't match. Try again."
    else
      break
    fi
  done
  unset again
  export HMBL_NEW_USER_PASSWORD
  pnpm --silent user:create --name "$owner_name" --email "$owner_email" --role owner
  unset HMBL_NEW_USER_PASSWORD
fi

step "Taking the first backup and proving it restores"
mkdir -p "$(grep -E '^STORAGE_DIR=' .env | cut -d= -f2-)"
bash scripts/backup-db.sh "$database"
pnpm --silent db:restore-check

step "Creating today's reminders"
pnpm --silent notifications:run

step "Running the readiness checks"
if pnpm --silent readiness; then
  readiness="passed"
else
  readiness="failed"
fi

cat <<EOF

HMBL OS is installed. Next:

  1. Start it:       pnpm start
  2. Open:           http://localhost:3000 and sign in. You'll set up
                     two-factor with an authenticator app first.
  3. Add the company: Administration → Organisation → New legal entity
                     (HMBL Entertainment, its registered name, country,
                     currency and tax registrations).
  4. Schedule daily backups and reminders:  pnpm live:schedule

EOF
if [ "$readiness" = "failed" ]; then
  echo "The readiness checks reported a FAIL above. Fix it before entering real work;"
  echo "after the steps above, run them again with: pnpm readiness"
fi
