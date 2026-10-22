import "server-only";
import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/** What a form's server action returns when it doesn't redirect. */
export type FormState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** The submitted values, so a failed submission never clears the form. */
  values?: Record<string, string>;
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
