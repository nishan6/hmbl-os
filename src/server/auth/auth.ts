import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { auditSignedIn, auditSignInBlocked, auditSignInFailed } from "@/server/audit/auth-events";
import { db } from "@/server/db";
import { env } from "@/lib/env";

const HOUR = 60 * 60;

/**
 * Better Auth configuration. Email and password only; public sign-up is off,
 * so accounts are created by an administrator or `pnpm user:create`.
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
    useSecureCookies: env().APP_ENV === "production",
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
        after: async (session) => {
          await auditSignedIn(session);
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email" || !isAPIError(ctx.context.returned)) return;
      const headers = ctx.request?.headers ?? ctx.headers;
      await auditSignInFailed(
        (ctx.body as { email?: unknown } | undefined)?.email,
        headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        headers?.get("user-agent") ?? null,
      );
    }),
  },
  plugins: [nextCookies()],
});
