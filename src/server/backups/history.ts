import "server-only";
import { db } from "@/server/db";
import { authorizeEverywhere, type Actor } from "@/server/permissions/authorize";

/** The latest restore checks, newest first (docs/backups.md). */
export async function latestRestoreChecks(actor: Actor, limit = 10) {
  authorizeEverywhere(actor, "organisation.configure");
  return db.restoreCheck.findMany({ orderBy: { checkedAt: "desc" }, take: limit });
}
