import "server-only";
import { db } from "@/server/db";
import { financeSettingsOf } from "./settings";

/**
 * What a printed invoice carries beyond the invoice itself: the entity's
 * invoice layout settings, its PAN and the name of the service sold. Callers
 * have already authorised the invoice (staff `getInvoice`, portal
 * `getClientInvoice`); everything here is printed on the document anyway.
 */
export async function invoiceDocumentExtras(inv: {
  legalEntityId: string;
  serviceCode: string | null;
  entityGstin: string | null;
}) {
  const [settings, pan, service] = await Promise.all([
    financeSettingsOf(db, inv.legalEntityId),
    db.taxRegistration.findFirst({
      where: { legalEntityId: inv.legalEntityId, type: { equals: "PAN", mode: "insensitive" } },
      select: { value: true },
    }),
    inv.serviceCode
      ? db.invoiceService.findUnique({
          where: {
            legalEntityId_code: { legalEntityId: inv.legalEntityId, code: inv.serviceCode },
          },
          select: { name: true },
        })
      : null,
  ]);
  return {
    settings,
    // An Indian GSTIN carries the PAN in characters 3 to 12.
    pan: pan?.value ?? (inv.entityGstin?.length === 15 ? inv.entityGstin.slice(2, 12) : null),
    serviceName: service?.name ?? null,
  };
}
