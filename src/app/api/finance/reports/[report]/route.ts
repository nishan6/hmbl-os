import { requireActor } from "@/server/auth/session";
import { reportCsv } from "@/server/finance/report-export";
import { errorResponse } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";

/** Downloads a financial report as CSV. */
export async function GET(request: Request, ctx: RouteContext<"/api/finance/reports/[report]">) {
  try {
    const { report } = await ctx.params;
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const { fileName, csv } = await reportCsv(await requireActor(), report, params);
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
