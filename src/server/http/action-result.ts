import "server-only";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** What a form's server action returns when it doesn't redirect. */
export type FormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** The submitted values, so a failed submission never clears the form. */
  values?: Record<string, string>;
  /** Set on success, so a form can tell two successful submissions apart. */
  savedAt?: number;
};

export const idle: FormState = { status: "idle" };

export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData) if (typeof value === "string") values[key] = value;
  return values;
}

/**
 * Turns a thrown error into form state. Known errors carry user-safe messages;
 * anything else is logged and replaced with a generic message.
 */
export function toFormState(error: unknown, values: Record<string, string>): FormState {
  if (error instanceof ValidationError) {
    return { status: "error", message: error.message, fieldErrors: error.fieldErrors, values };
  }
  if (error instanceof AppError) return { status: "error", message: error.message, values };
  logger.error("unexpected error in form action", { error });
  return { status: "error", message: "Something went wrong. Nothing was saved.", values };
}

/**
 * Runs a mutation for a form action: success state when it works, error state
 * (with the submitted values kept) when it throws. Redirects belong outside.
 */
export async function attempt(
  formData: FormData,
  run: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
): Promise<FormState> {
  const values = formValues(formData);
  try {
    await run(values);
  } catch (error) {
    return toFormState(error, values);
  }
  return { status: "success", message, savedAt: Date.now() };
}
