import { requireActor } from "@/server/auth/session";
import { uploadDocument } from "@/server/documents/documents";
import { errorResponse, sameOrigin } from "@/server/http/route-errors";
import { env } from "@/lib/env";
import { ForbiddenError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Uploads one document to a record. The file is the raw request body,
 * streamed to disk, so there is no size limit and nothing large is held in
 * memory. Details come in the query string. This path is outside the proxy,
 * which would otherwise buffer and cut off large bodies (docs/documents.md).
 */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request, env().APP_URL)) throw new ForbiddenError();
    const query = new URL(request.url).searchParams;
    const doc = await uploadDocument(
      await requireActor(),
      { type: (query.get("recordType") ?? "") as "PROJECT", id: query.get("recordId") ?? "" },
      {
        category: (query.get("category") ?? "") as "OTHER",
        title: query.get("title"),
        fileName: query.get("fileName") ?? "",
        contentType: request.headers.get("content-type"),
        restricted: query.get("restricted"),
        previousVersionId: query.get("previousVersionId"),
      },
      request.body,
    );
    return Response.json({ id: doc.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
