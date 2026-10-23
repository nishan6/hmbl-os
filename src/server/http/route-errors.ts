import "server-only";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

const STATUS = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
} as const;

/** A JSON error response for a route handler; unexpected errors are logged, not shown. */
export function errorResponse(error: unknown) {
  if (error instanceof AppError) {
    return Response.json(
      {
        error: error.message,
        fieldErrors: error instanceof ValidationError ? error.fieldErrors : {},
      },
      { status: STATUS[error.code] },
    );
  }
  logger.error("route handler failed", { error });
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/** Refuses a cookie-authenticated write that didn't come from this app's pages. */
export function sameOrigin(request: Request, appUrl: string) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(appUrl).origin;
}
