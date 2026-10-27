import type { Instrumentation } from "next";

/**
 * Keeps every server error with its reference, so an administrator can find
 * it from the reference a person quotes (docs/monitoring.md).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordRequestError } = await import("@/server/monitoring/errors");
  await recordRequestError({
    error,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
