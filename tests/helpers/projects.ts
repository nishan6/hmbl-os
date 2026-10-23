import { db } from "@/server/db";
import { createQuote, localToday, saveDraft } from "@/server/commercial/quotes";
import { issueQuote } from "@/server/commercial/workflow";
import { acceptQuote } from "@/server/commercial/acceptance";
import { ensureProjectTypeDefaults } from "@/server/projects/types";
import { makeActor } from "./actors";
import { makeClient } from "./crm";
import { makeQuotingEntity, taxRate } from "./commercial";

/**
 * An accepted quote's project: stage build (cost 60,000, revenue 100,000) and
 * show crew (4 × 2 days at 3,000 cost, 5,000 price), 50% advance terms.
 */
export async function makeAcceptedProject() {
  await ensureProjectTypeDefaults(db);
  const entity = await makeQuotingEntity();
  const client = await makeClient();
  const sales = await makeActor("sales");
  const quote = await createQuote(sales, {
    legalEntityId: entity.id,
    clientId: client.id,
    title: "Award night",
  });
  const term = await db.paymentTerm.findUniqueOrThrow({ where: { code: "ADV50" } });
  await saveDraft(sales, quote.id, {
    title: "Award night",
    currency: "INR",
    validUntil: "2099-12-31",
    taxRateId: (await taxRate("GST18")).id,
    paymentTermId: term.id,
    eventStartDate: "2099-03-10",
    eventEndDate: "2099-03-12",
    venue: "Dome, Mumbai",
    scope: "Stage, sound and crew for the awards.",
    lines: [
      {
        section: "Stage",
        category: "PRODUCTION",
        description: "Stage build",
        method: "FIXED",
        unitCost: "60000",
        unitPrice: "100000",
      },
      {
        category: "CREW",
        description: "Show crew",
        method: "UNIT_RATE",
        quantity: "4",
        days: "2",
        unitCost: "3000",
        unitPrice: "5000",
      },
    ],
  });
  await issueQuote(sales, quote.id);
  const project = await acceptQuote(sales, quote.id, {
    acceptedOn: localToday("Asia/Kolkata").toISOString().slice(0, 10),
    acceptedByName: "Asha Rao",
    acceptanceMethod: "EMAIL",
  });
  return { entity, client, sales, quote, project };
}
