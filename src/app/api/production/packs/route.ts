import { requireActor } from "@/server/auth/session";
import { offlineShows } from "@/server/production/pack";
import { errorResponse } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";

/** The shows the signed-in user may keep offline now (docs/offline.md). */
export async function GET() {
  try {
    const actor = await requireActor();
    return Response.json(
      { userId: actor.id, shows: await offlineShows(actor) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
