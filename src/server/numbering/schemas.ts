import { z } from "zod";
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
