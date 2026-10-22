import { symmetricEncrypt } from "better-auth/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { loadGrants } from "@/server/permissions/grants";
import { requiresTwoFactor } from "@/server/auth/two-factor-policy";
import { DEMO_TOTP_SECRET } from "./demo-credentials";

/** Demo backup codes, one-use each, same for every demo user. */
const DEMO_BACKUP_CODES = Array.from({ length: 10 }, (_, i) => `demo0-code${i}`);

/**
 * Gives demo users whose role requires two-factor the shared demo
 * authenticator secret, encrypted the way Better Auth stores it, so they can
 * sign in locally and in tests. Users who already have two-factor are left alone.
 */
export async function seedDemoTwoFactor(db: PrismaClient, emails: string[]) {
  const key = env().BETTER_AUTH_SECRET;
  const users = await db.user.findMany({
    where: { email: { in: emails }, twoFactorEnabled: false },
    select: { id: true, email: true },
  });
  for (const user of users) {
    if (!requiresTwoFactor(await loadGrants(db, user.id))) continue;
    await db.$transaction([
      db.twoFactor.create({
        data: {
          userId: user.id,
          secret: await symmetricEncrypt({ key, data: DEMO_TOTP_SECRET }),
          backupCodes: await symmetricEncrypt({ key, data: JSON.stringify(DEMO_BACKUP_CODES) }),
          verified: true,
        },
      }),
      db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } }),
    ]);
    console.log(`Demo two-factor: ${user.email}`);
  }
}
