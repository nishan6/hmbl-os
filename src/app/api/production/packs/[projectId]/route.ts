import { requireActor } from "@/server/auth/session";
import { buildShowPack } from "@/server/production/pack";
import { errorResponse } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";

/**
 * One show's offline pack. A 401 tells the field app to wipe everything it
 * holds; a 403 or 404 tells it to wipe this show (docs/offline.md).
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/production/packs/[projectId]">,
) {
  try {
    const { projectId } = await ctx.params;
    const pack = await buildShowPack(await requireActor(), projectId);
    return Response.json(pack, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
