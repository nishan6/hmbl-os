import { calendarFeedFor } from "@/server/integrations/calendar-feed";

export const dynamic = "force-dynamic";

/**
 * The calendar feed for a private link (docs/integrations.md). Calendar apps
 * fetch it without a session, so the secret in the link is the only key.
 */
export async function GET(_: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  const { token } = await ctx.params;
  const ics = await calendarFeedFor(token.replace(/\.ics$/, ""));
  if (ics === null) return new Response("Not found", { status: 404 });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="hmbl-os.ics"',
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
