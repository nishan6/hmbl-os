/**
 * Proves a backup restores (docs/backups.md): restores the newest backup of
 * the database in .env (or the dump given) into a scratch database, runs the
 * integrity checks against it, looks for its documents in the backup folder,
 * keeps the result as evidence and drops the scratch database. Exits with 1
 * when the backup fails any check. Run it monthly, and after changing how
 * backups are taken:
 *
 *   pnpm db:restore-check
 *   pnpm db:restore-check backups/hmbl_live-20261027-190000.dump --keep
 */
import "dotenv/config";
import { checkRestore } from "@/server/backups/restore-check";
import { db } from "@/server/db";

const MARK = { pass: "PASS", warn: "WARN", fail: "FAIL" } as const;

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const check = await checkRestore("system", { file, keep: args.includes("--keep") });
  console.log(`Restore check of ${check.backupFile} (${check.database})\n`);
  for (const r of check.results) {
    console.log(`  ${MARK[r.state]}  ${r.title}: ${r.summary}`);
    for (const e of r.evidence) console.log(`        ${e}`);
  }
  console.log(
    `\n${check.passed ? "The backup restores and checks out." : "The backup FAILED its restore check."} ${(check.durationMs / 1000).toFixed(1)} s. Kept as evidence ${check.id}.`,
  );
  if (!check.passed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
