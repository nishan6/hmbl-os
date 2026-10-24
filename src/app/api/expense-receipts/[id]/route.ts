import { requireActor } from "@/server/auth/session";
import { openExpenseReceipt } from "@/server/expenses/claims";
import { canPreview } from "@/server/projects/document-rules";
import { errorResponse } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";

/**
 * Downloads a receipt after checking the viewer can see its claim.
 * `?preview=1` opens PDFs and images in the browser, sandboxed.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/expense-receipts/[id]">) {
  try {
    const { id } = await ctx.params;
    const { receipt, file } = await openExpenseReceipt(await requireActor(), id);
    const inline =
      new URL(request.url).searchParams.get("preview") === "1" && canPreview(receipt.fileName);
    const name = encodeURIComponent(receipt.fileName);
    return new Response(file.stream, {
      headers: {
        "Content-Type": inline ? receipt.contentType : "application/octet-stream",
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
