/**
 * Runs the date-based notification checks, then sends queued email
 * (docs/notifications.md). Schedule it once a day, e.g. from cron:
 *
 *   15 6 * * *  cd /srv/hmbl-os && pnpm notifications:run
 *
 * Safe to run more often: every notification is keyed, so nobody is
 * notified twice for the same thing.
 */
import "dotenv/config";
import { runSweep } from "@/server/notifications/sweep";
import { deliverPending } from "@/server/notifications/delivery";
import { db } from "@/server/db";

async function main() {
  const created = await runSweep();
  const delivered = await deliverPending();
  console.log(JSON.stringify({ created, delivered }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
