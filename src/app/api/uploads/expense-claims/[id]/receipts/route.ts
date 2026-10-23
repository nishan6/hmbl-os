import { requireActor } from "@/server/auth/session";
import { uploadExpenseReceipt } from "@/server/expenses/claims";
import { errorResponse, sameOrigin } from "@/server/http/route-errors";
import { env } from "@/lib/env";
import { ForbiddenError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Uploads one receipt to an expense claim, streamed like project documents
 * (docs/expenses.md). Details come in the query string.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/uploads/expense-claims/[id]/receipts">,
) {
  try {
    if (!sameOrigin(request, env().APP_URL)) throw new ForbiddenError();
    const { id } = await ctx.params;
    const query = new URL(request.url).searchParams;
    const receipt = await uploadExpenseReceipt(
      await requireActor(),
      id,
      {
        fileName: query.get("fileName") ?? "",
        contentType: request.headers.get("content-type"),
        lineId: query.get("lineId"),
      },
      request.body,
    );
    return Response.json({ id: receipt.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
