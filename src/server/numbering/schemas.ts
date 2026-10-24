import { z } from "zod";
import { numberCodeSchema } from "@/lib/validation";
import { requiredDate } from "@/server/projects/schemas";
import { isDocumentType } from "./document-types";

export const numberingSchemeInput = z.object({
  documentType: z.string().refine(isDocumentType, "Unknown document type"),
  legalEntityId: z.uuid(),
  pattern: z.string().trim().min(1, "Required").max(60),
  resetPolicy: z.enum(["NEVER", "YEARLY", "FISCAL_YEARLY", "MONTHLY"]),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(4),
  startAt: z.coerce.number().int().min(1).max(1_000_000_000).default(1),
});
export type NumberingSchemeInput = z.input<typeof numberingSchemeInput>;

export const replaceSchemeInput = numberingSchemeInput.omit({
  documentType: true,
  legalEntityId: true,
});
export type ReplaceSchemeInput = z.input<typeof replaceSchemeInput>;

export const counterInput = z.object({
  /** Any date in the period whose count is being set. */
  date: requiredDate,
  /** Set a client's own count ({CSEQ}) instead of the overall one. */
  clientCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null)
    .pipe(numberCodeSchema.nullable()),
  lastValue: z.coerce
    .number({ message: "Enter a whole number" })
    .int("Enter a whole number")
    .min(1, "Enter 1 or more")
    .max(1_000_000_000),
});
export type CounterInput = z.input<typeof counterInput>;
