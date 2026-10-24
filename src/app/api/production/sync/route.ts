import { requireActor } from "@/server/auth/session";
import { applyOfflineOperations } from "@/server/production/sync";
import { errorResponse, sameOrigin } from "@/server/http/route-errors";
import { env } from "@/lib/env";
import { ForbiddenError, ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Receives changes the field app queued offline (docs/offline.md). A 401
 * tells the app to sign in again; it keeps the changes and resends them
 * once the same user is back.
 */
export async function POST(request: Request) {
  try {
    if (!sameOrigin(request, env().APP_URL)) throw new ForbiddenError();
    const actor = await requireActor();
    const body = await request.json().catch(() => {
      throw new ValidationError("Send the changes as JSON.");
    });
    const results = await applyOfflineOperations(actor, body);
    return Response.json({ results }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
