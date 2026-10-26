import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic redirect only: sends visitors with no session cookie to sign in.
 * Real authentication and permission checks happen on the server for every
 * page, action and route handler.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = new URL("/sign-in", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except sign-in, portal invitations, the auth, health, upload,
  // offline show-pack and calendar feed APIs, the field app's service worker,
  // and static assets. Uploads stream large bodies the proxy would buffer and cut off;
  // the field app must get a 401, not a sign-in page, to know to wipe its
  // offline data. Calendar apps fetch the feed without a session; the secret
  // in its link is the key. Their route handlers check access themselves.
  matcher: [
    "/((?!sign-in|invite/|api/auth|api/health|api/uploads|api/production|api/calendar/|sw\\.js|_next/static|_next/image|favicon.ico).*)",
  ],
};
