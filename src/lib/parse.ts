import { z } from "zod";
import { ValidationError } from "./errors";

/** Parses input with a Zod schema, throwing a ValidationError with field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      "Check the highlighted fields.",
      z.flattenError(result.error).fieldErrors as Record<string, string[]>,
    );
  }
  return result.data;
}
