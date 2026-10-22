import "server-only";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import {
  auditSignedIn,
  auditSignInFailed,
  auditTwoFactorChange,
  auditTwoFactorFailed,
} from "@/server/audit/auth-events";
import { db } from "@/server/db";
import { loadGrants } from "@/server/permissions/grants";
import { requiresTwoFactor } from "./two-factor-policy";

const SIGN_IN_PATHS = [
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
];

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

function requestInfo(ctx: HookContext) {
  const headers = ctx.request?.headers ?? ctx.headers;
  return {
    ipAddress: headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headers?.get("user-agent") ?? null,
    cookie: headers?.get("cookie") ?? "",
  };
}

/** True when the request carried a session cookie, i.e. a signed-in user managing their own account. */
function hadSession(ctx: HookContext) {
  return requestInfo(ctx).cookie.includes(`${ctx.context.authCookies.sessionToken.name}=`);
}

/**
 * Audit events and policy for sign-in and two-factor. Registered after the
 * two-factor plugin so its hooks see the final outcome: a password sign-in
 * that still needs a code has no session yet and is not logged as signed in.
 */
export const hmblAuthPolicy = () =>
  ({
    id: "hmbl-auth-policy",
    hooks: {
      before: [
        {
          // Roles that require two-factor can't switch it off.
          matcher: (ctx) => ctx.path === "/two-factor/disable",
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (session && requiresTwoFactor(await loadGrants(db, session.user.id))) {
              throw new APIError("FORBIDDEN", {
                message: "Your role requires two-factor sign-in, so it can't be turned off.",
              });
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => SIGN_IN_PATHS.includes(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const { ipAddress, userAgent } = requestInfo(ctx);
            const failed = isAPIError(ctx.context.returned);
            if (ctx.path === "/sign-in/email") {
              if (failed) await auditSignInFailed(ctx.body?.email, ipAddress, userAgent);
              else if (ctx.context.newSession) await auditSignedIn(ctx.context.newSession.session);
              return;
            }
            if (hadSession(ctx)) {
              // Confirming a new authenticator app while signed in.
              if (!failed && ctx.path === "/two-factor/verify-totp" && ctx.context.newSession) {
                await auditTwoFactorChange(
                  ctx.context.newSession.user.id,
                  "user.two_factor_enabled",
                );
              }
              return;
            }
            if (failed) {
              await auditTwoFactorFailed(null, ipAddress, userAgent);
            } else if (ctx.context.newSession) {
              await auditSignedIn(ctx.context.newSession.session);
            }
          }),
        },
        {
          matcher: (ctx) =>
            ctx.path === "/two-factor/disable" || ctx.path === "/two-factor/generate-backup-codes",
          handler: createAuthMiddleware(async (ctx) => {
            if (isAPIError(ctx.context.returned)) return;
            const session = await getSessionFromCtx(ctx).catch(() => null);
            const userId = ctx.context.newSession?.user.id ?? session?.user.id;
            if (!userId) return;
            await auditTwoFactorChange(
              userId,
              ctx.path === "/two-factor/disable"
                ? "user.two_factor_disabled"
                : "user.backup_codes_regenerated",
            );
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
