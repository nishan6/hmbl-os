import { requirePortalActor } from "@/server/portal/session";
import { uploadVendorInvoice } from "@/server/portal/vendor";
import { errorResponse, sameOrigin } from "@/server/http/route-errors";
import { env } from "@/lib/env";
import { ForbiddenError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * A vendor uploads their invoice for an order. The file is the raw request
 * body, streamed to disk; details come in the query string. Outside the
 * proxy, like the other uploads (docs/documents.md).
 */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request, env().APP_URL)) throw new ForbiddenError();
    const query = new URL(request.url).searchParams;
    const upload = await uploadVendorInvoice(
      await requirePortalActor(),
      query.get("orderId") ?? "",
      {
        vendorInvoiceNumber: query.get("vendorInvoiceNumber") ?? "",
        invoiceDate: query.get("invoiceDate") ?? "",
        total: query.get("total") ?? "",
        note: query.get("note"),
        fileName: query.get("fileName") ?? "",
        contentType: request.headers.get("content-type"),
      },
      request.body,
    );
    return Response.json({ id: upload.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
