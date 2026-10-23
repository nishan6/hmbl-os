import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import type { Caller } from "@/server/permissions/authorize";
import { DEFAULT_SCHEMES, type DocumentType } from "./document-types";

/** India's financial year starts in April; elsewhere the default is the calendar year. */
export function defaultFiscalYearStartMonth(countryCode: string): number {
  return countryCode === "IN" ? 4 : 1;
}

/**
 * Gives an entity the default number format for every document type it has
 * no active format for. Runs inside the caller's transaction and audits each
 * scheme it creates. Returns the document types it added.
 */
export async function addMissingDefaultSchemes(
  tx: Prisma.TransactionClient,
  caller: Caller,
  entity: { id: string; countryCode: string },
): Promise<DocumentType[]> {
  const existing = await tx.numberingScheme.findMany({
    where: { legalEntityId: entity.id, status: "ACTIVE" },
    select: { documentType: true },
  });
  const have = new Set(existing.map((s) => s.documentType));
  const added: DocumentType[] = [];
  for (const [documentType, { pattern, resetPolicy }] of Object.entries(DEFAULT_SCHEMES)) {
    if (have.has(documentType)) continue;
    const scheme = await tx.numberingScheme.create({
      data: {
        documentType,
        legalEntityId: entity.id,
        pattern,
        resetPolicy,
        fiscalYearStartMonth: defaultFiscalYearStartMonth(entity.countryCode),
      },
    });
    await recordAudit(tx, caller, {
      action: "numbering_scheme.created",
      targetType: "numbering_scheme",
      targetId: scheme.id,
      legalEntityId: entity.id,
      changes: diffChanges(null, scheme, ["documentType", "pattern", "resetPolicy"]),
      metadata: { source: "default" },
    });
    added.push(documentType as DocumentType);
  }
  return added;
}
