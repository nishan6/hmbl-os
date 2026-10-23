import { requireActor } from "@/server/auth/session";
import { openDocument } from "@/server/projects/documents";
import { canPreview } from "@/server/projects/document-rules";
import { errorResponse } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";

/**
 * Downloads a document after checking the viewer can see its project.
 * `?preview=1` opens PDFs and images in the browser, sandboxed; everything
 * else is always a download.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  try {
    const { id } = await ctx.params;
    const { doc, file } = await openDocument(await requireActor(), id);
    const inline =
      new URL(request.url).searchParams.get("preview") === "1" && canPreview(doc.fileName);
    const name = encodeURIComponent(doc.fileName);
    return new Response(file.stream, {
      headers: {
        "Content-Type": inline ? doc.contentType : "application/octet-stream",
        "Content-Length": String(file.size),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
