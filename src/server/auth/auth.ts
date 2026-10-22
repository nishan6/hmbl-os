import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { auditSignInBlocked } from "@/server/audit/auth-events";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { hmblAuthPolicy } from "./audit-plugin";

const HOUR = 60 * 60;

/**
 * Better Auth configuration. Email and password, plus two-factor with an
 * authenticator app; public sign-up is off, so accounts are created by an
 * administrator or `pnpm user:create`.
 * Session lengths are labelled defaults (docs/decisions.md).
 */
export const auth = betterAuth({
  secret: env().BETTER_AUTH_SECRET,
  baseURL: env().APP_URL,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 12 * HOUR,
    updateAge: 1 * HOUR,
  },
  rateLimit: {
    enabled: env().APP_ENV !== "test",
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
  advanced: {
    database: { generateId: "uuid" },
    // Secure cookies need HTTPS; a production build on http://localhost runs without them.
    useSecureCookies: env().APP_URL.startsWith("https://"),
  },
  user: {
    additionalFields: {
      status: { type: "string", required: false, input: false, defaultValue: "ACTIVE" },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // A disabled user cannot start a session, even with the right password.
        before: async (session) => {
          const user = await db.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });
          if (user?.status === "ACTIVE") return true;
          await auditSignInBlocked(session, "user disabled");
          return false;
        },
      },
    },
  },
  plugins: [
    // Authenticator apps (TOTP) plus one-time backup codes. Free, no SMS or
    // third-party service. Secrets and codes are encrypted at rest.
    twoFactor({ issuer: "HMBL OS" }),
    // Must follow twoFactor(): audits sign-ins only once any code is verified.
    hmblAuthPolicy(),
    nextCookies(),
  ],
});
