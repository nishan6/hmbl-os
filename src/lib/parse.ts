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

/**
 * Like parseInput, but field errors keep their full path, e.g.
 * "lines.2.unitPrice", for forms with repeated rows.
 */
export function parseNestedInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.map(String).join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new ValidationError("Check the highlighted fields.", fieldErrors);
  }
  return result.data;
}
