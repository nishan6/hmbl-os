import { requireActor } from "@/server/auth/session";
import { problemRowsCsv } from "@/server/imports/batches";
import { errorResponse } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";

/** Downloads an import's rows that weren't written, with the reason for each. */
export async function GET(_: Request, ctx: RouteContext<"/api/imports/[id]/problems">) {
  try {
    const { id } = await ctx.params;
    const { fileName, csv } = await problemRowsCsv(await requireActor(), id);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
