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
  // Everything except sign-in, the auth, health and upload APIs, and static
  // assets. Uploads stream large bodies the proxy would buffer and cut off;
  // their route handler checks the session itself.
  matcher: [
    "/((?!sign-in|api/auth|api/health|api/uploads|_next/static|_next/image|favicon.ico).*)",
  ],
};
