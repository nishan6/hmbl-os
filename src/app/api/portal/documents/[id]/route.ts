import { openSharedDocument } from "@/server/portal/client";
import { requirePortalActor } from "@/server/portal/session";
import { errorResponse } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";

/** Downloads a document shared with the signed-in client, by its share. Always a download. */
export async function GET(_: Request, ctx: RouteContext<"/api/portal/documents/[id]">) {
  try {
    const { id } = await ctx.params;
    const { doc, file } = await openSharedDocument(await requirePortalActor(), id);
    const name = encodeURIComponent(doc.fileName);
    return new Response(file.stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${name}`,
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
