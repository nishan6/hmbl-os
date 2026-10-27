/**
 * Runs the date-based notification checks, then sends queued email
 * (docs/notifications.md). Schedule it once a day, e.g. from cron:
 *
 *   15 6 * * *  cd /srv/hmbl-os && pnpm notifications:run
 *
 * Safe to run more often: every notification is keyed, so nobody is
 * notified twice for the same thing. Each run is recorded, so the readiness
 * checks notice when it stops running or fails (docs/monitoring.md).
 */
import "dotenv/config";
import { runSweep } from "@/server/notifications/sweep";
import { deliverPending } from "@/server/notifications/delivery";
import { runJob } from "@/server/monitoring/jobs";
import { db } from "@/server/db";

async function main() {
  const summary = await runJob("notifications", async () => {
    const created = await runSweep();
    const delivered = await deliverPending();
    return JSON.parse(JSON.stringify({ created, delivered }));
  });
  console.log(JSON.stringify(summary));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
