import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit/record";
import type { Caller } from "@/server/permissions/authorize";
import { DEFAULT_SCHEMES, type DocumentType } from "@/server/numbering/document-types";
import { defaultFiscalYearStartMonth } from "@/server/numbering/defaults";
import { allocateNumber } from "@/server/numbering/service";

/**
 * The next number for a finance document. An entity created before this
 * document type existed gets the default format the first time; one whose
 * format was archived on purpose does not.
 */
export async function financeNumber(
  tx: Prisma.TransactionClient,
  caller: Caller,
  request: { documentType: DocumentType; legalEntityId: string; date: Date },
) {
  const known = await tx.numberingScheme.count({
    where: { documentType: request.documentType, legalEntityId: request.legalEntityId },
  });
  if (!known) {
    const entity = await tx.legalEntity.findUniqueOrThrow({ where: { id: request.legalEntityId } });
    const { pattern, resetPolicy } = DEFAULT_SCHEMES[request.documentType];
    const scheme = await tx.numberingScheme.create({
      data: {
        documentType: request.documentType,
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
      metadata: { source: "default", documentType: request.documentType, pattern },
    });
  }
  return allocateNumber(tx, request);
}
