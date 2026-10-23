import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { mergeClient } from "@/server/crm/clients";
import { createOpportunity } from "@/server/crm/pipeline";
import {
  createQuote,
  getQuote,
  listQuotes,
  localToday,
  saveDraft,
} from "@/server/commercial/quotes";
import type { DraftInput, DraftLineInput } from "@/server/commercial/schemas";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeClient, stages } from "../helpers/crm";
import { makeQuotingEntity, taxRate } from "../helpers/commercial";

/** The quote's default tax, GST 18%, set by setup(). */
let headerTaxId = "";

async function setup() {
  const entity = await makeQuotingEntity();
  headerTaxId = (await taxRate("GST18")).id;
  const client = await makeClient();
  const sales = await makeActor("sales");
  const quote = await createQuote(sales, {
    legalEntityId: entity.id,
    clientId: client.id,
    title: "Product launch",
  });
  return { entity, client, sales, quote };
}

const line = (over: Partial<DraftLineInput> = {}): DraftLineInput => ({
  category: "SERVICES",
  description: "Show management",
  method: "UNIT_RATE",
  quantity: "1",
  days: "1",
  unitCost: "",
  unitPrice: "",
  ...over,
});

const draft = (over: Partial<DraftInput> = {}): DraftInput => ({
  title: "Product launch",
  currency: "INR",
  validUntil: "2026-12-31",
  taxRateId: headerTaxId,
  lines: [],
  ...over,
});

const expectFieldError = async (promise: Promise<unknown>, field: string) => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ValidationError);
  expect(Object.keys((error as ValidationError).fieldErrors)).toContain(field);
};

describe("creating a quote", () => {
  it("numbers it and starts version 1 with the default terms", async () => {
    const { entity, sales, quote } = await setup();
    expect(quote.number).toMatch(/^Q-\d{4}-0001$/);
    const full = await getQuote(sales, quote.id);
    const gst18 = await taxRate("GST18");
    expect(full.version).toMatchObject({
      version: 1,
      status: "DRAFT",
      currency: "INR",
      taxRateId: gst18.id,
      taxRateBps: 1800,
      paymentTermName: expect.stringMatching(/50%/),
    });
    expect(full.version.paymentSchedule).toHaveLength(2);
    const validFor = full.version.validUntil.getTime() - localToday(entity.timezone).getTime();
    expect(validFor / 86_400_000).toBe(30);
    expect(
      await db.auditEvent.count({ where: { action: "quote.created", targetId: quote.id } }),
    ).toBe(1);
  });

  it("takes currency, dates and venue from the opportunity", async () => {
    await stages();
    const entity = await makeQuotingEntity();
    const client = await makeClient();
    const sales = await makeActor("sales");
    const opportunity = await createOpportunity(sales, {
      legalEntityId: entity.id,
      clientId: client.id,
      title: "Dubai gala",
      currency: "AED",
      eventStartDate: "2027-02-10",
      venue: "Atlantis",
    });
    const quote = await createQuote(sales, {
      legalEntityId: entity.id,
      clientId: client.id,
      opportunityId: opportunity.id,
      title: "Dubai gala",
    });
    const full = await getQuote(sales, quote.id);
    expect(full.version).toMatchObject({ currency: "AED", venue: "Atlantis" });
    expect(full.version.eventStartDate?.toISOString()).toBe("2027-02-10T00:00:00.000Z");
  });

  it("refuses an opportunity for another client", async () => {
    await stages();
    const { entity, sales } = await setup();
    const other = await makeClient();
    const mine = await makeClient();
    const opportunity = await createOpportunity(sales, {
      legalEntityId: entity.id,
      clientId: other.id,
      title: "Elsewhere",
      currency: "INR",
    });
    await expectFieldError(
      createQuote(sales, {
        legalEntityId: entity.id,
        clientId: mine.id,
        opportunityId: opportunity.id,
        title: "X",
      }),
      "opportunityId",
    );
  });

  it("needs commercial.create for the entity", async () => {
    const entity = await makeQuotingEntity();
    const client = await makeClient();
    const viewer = await makeActor("viewer");
    await expect(
      createQuote(viewer, { legalEntityId: entity.id, clientId: client.id, title: "X" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("saving a draft", () => {
  it("prices every line on the server and stores the totals", async () => {
    const { sales, quote } = await setup();
    const gst5 = await taxRate("GST5");
    await saveDraft(
      sales,
      quote.id,
      draft({
        contingency: "5",
        lines: [
          // 2 crew × 3 days × ₹8,000 cost, sold at ₹12,000.
          line({
            category: "CREW",
            description: "Stage hands",
            quantity: "2",
            days: "3",
            unitCost: "8000",
            unitPrice: "12000",
          }),
          // ₹50,000 cost at a 25% target margin, 10% discount, taxed at 5%.
          line({
            description: "LED wall",
            method: "COST_PLUS_MARGIN",
            unitCost: "50000",
            margin: "25",
            discount: "10",
            taxRateId: gst5.id,
          }),
          line({ description: "Design fee", method: "FIXED", unitCost: "0", unitPrice: "25000" }),
        ],
      }),
    );
    const { version } = await getQuote(sales, quote.id);
    const [crew, led, fee] = version.lines;
    expect(crew).toMatchObject({ costMinor: 4800000n, netMinor: 7200000n, taxMinor: 1296000n });
    // 50,000 ÷ 0.75 = 66,666.67; less 10% = 60,000.00
    expect(led).toMatchObject({
      grossMinor: 6666667n,
      discountMinor: 666667n,
      netMinor: 6000000n,
      taxCode: "GST5",
      taxMinor: 300000n,
    });
    expect(fee).toMatchObject({ netMinor: 2500000n, taxCode: "GST18" });
    expect(version).toMatchObject({
      subtotalMinor: 15700000n,
      contingencyMinor: 785000n,
      costMinor: 9800000n,
    });
    // Line tax 12,960 + 3,000 + 4,500, plus 18% on the 7,850 contingency.
    expect(version.taxMinor).toBe(1296000n + 300000n + 450000n + 141300n);
    expect(version.totalMinor).toBe(15700000n + 785000n + version.taxMinor);
    expect(version.marginBps).toBe(4055);
  });

  it("reports line errors by row and field", async () => {
    const { sales, quote } = await setup();
    await expectFieldError(
      saveDraft(sales, quote.id, draft({ lines: [line(), line({ unitPrice: "abc" })] })),
      "lines.1.unitPrice",
    );
    await expectFieldError(
      saveDraft(
        sales,
        quote.id,
        draft({ lines: [line({ method: "COST_PLUS_MARGIN", unitCost: "100", margin: "100" })] }),
      ),
      "lines.0.margin",
    );
    await expectFieldError(
      saveDraft(
        sales,
        quote.id,
        draft({ lines: [line({ method: "COST_PLUS_MARKUP", unitCost: "0", markup: "20" })] }),
      ),
      "lines.0.unitCost",
    );
    await expectFieldError(
      saveDraft(sales, quote.id, draft({ lines: [line({ quantity: "0" })] })),
      "lines.0.quantity",
    );
  });

  it("needs an exchange rate only for a foreign currency", async () => {
    const { sales, quote } = await setup();
    await expectFieldError(saveDraft(sales, quote.id, draft({ fxRate: "0" })), "fxRate");
    await saveDraft(
      sales,
      quote.id,
      draft({ currency: "AED", fxRate: "22.65", fxNote: "RBI ref" }),
    );
    expect((await getQuote(sales, quote.id)).version.fxRateToBase?.toString()).toBe("22.65");
    await saveDraft(sales, quote.id, draft({ currency: "INR", fxRate: "22.65" }));
    expect((await getQuote(sales, quote.id)).version.fxRateToBase).toBeNull();
  });

  it("audits what changed and skips a no-op save", async () => {
    const { sales, quote } = await setup();
    const input = draft({ lines: [line({ unitPrice: "1000" })], venue: "NSCI Dome" });
    await saveDraft(sales, quote.id, input);
    await saveDraft(sales, quote.id, input);
    const events = await db.auditEvent.findMany({ where: { action: "quote.draft_saved" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.changes).toMatchObject({
      venue: { from: null, to: "NSCI Dome" },
      totalMinor: { from: "0", to: "118000" },
    });
    expect(events[0]!.metadata).toMatchObject({ lines: { from: 0, to: 1 } });
  });

  it("refuses a stale save", async () => {
    const { sales, quote } = await setup();
    const loaded = await getQuote(sales, quote.id);
    await saveDraft(sales, quote.id, draft({ venue: "First" }));
    await expect(
      saveDraft(
        sales,
        quote.id,
        draft({ venue: "Second", expectedUpdatedAt: loaded.version.updatedAt.toISOString() }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("can't change a version that has left draft, even directly in the database", async () => {
    const { sales, quote } = await setup();
    await saveDraft(sales, quote.id, draft({ lines: [line({ unitPrice: "1000" })] }));
    const { version } = await getQuote(sales, quote.id);
    await db.quoteVersion.update({ where: { id: version.id }, data: { status: "ISSUED" } });
    await expect(saveDraft(sales, quote.id, draft())).rejects.toBeInstanceOf(ConflictError);
    await expect(
      db.quoteVersion.update({ where: { id: version.id }, data: { venue: "Changed" } }),
    ).rejects.toThrow(/can no longer be edited/);
    await expect(
      db.quoteLine.updateMany({ where: { versionId: version.id }, data: { unitPriceMinor: 1n } }),
    ).rejects.toThrow(/can no longer be changed/);
    await expect(db.quoteLine.deleteMany({ where: { versionId: version.id } })).rejects.toThrow(
      /can no longer be changed/,
    );
  });

  it("needs commercial.edit", async () => {
    const { quote } = await setup();
    const pm = await makeActor("project_manager");
    await expect(saveDraft(pm, quote.id, draft())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("who sees what", () => {
  it("hides cost and margin from people who can only view", async () => {
    const { sales, quote } = await setup();
    await saveDraft(
      sales,
      quote.id,
      draft({
        internalNotes: "Supplier owes us one",
        lines: [line({ unitCost: "600", unitPrice: "1000" })],
      }),
    );
    expect((await getQuote(sales, quote.id)).version.lines[0]!.costMinor).toBe(60000n);
    const pm = await makeActor("project_manager");
    const seen = await getQuote(pm, quote.id);
    expect(seen.showCosts).toBe(false);
    expect(seen.version).toMatchObject({ costMinor: 0n, marginBps: null, internalNotes: null });
    expect(seen.version.lines[0]).toMatchObject({ unitCostMinor: 0n, costMinor: 0n });
    expect(seen.version.lines[0]!.netMinor).toBe(100000n);
    const finance = await makeActor("finance");
    expect((await getQuote(finance, quote.id)).showCosts).toBe(true);
  });

  it("keeps quotes inside the actor's entities", async () => {
    const { entity, sales, quote } = await setup();
    const other = await makeQuotingEntity();
    const scoped = await makeScopedActor("sales", other.id);
    await expect(getQuote(scoped, quote.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(saveDraft(scoped, quote.id, draft())).rejects.toBeInstanceOf(NotFoundError);
    expect(await listQuotes(scoped)).toHaveLength(0);
    const mine = await listQuotes(sales, { search: "launch" });
    expect(mine.map((q) => [q.legalEntityId, q.latest.status])).toEqual([[entity.id, "DRAFT"]]);
  });
});

describe("client merges", () => {
  it("move quotes to the surviving client", async () => {
    const { client, quote } = await setup();
    const owner = await makeActor("owner");
    const survivor = await makeClient();
    await mergeClient(owner, client.id, { targetId: survivor.id, reason: "Duplicate" });
    expect((await db.quote.findUniqueOrThrow({ where: { id: quote.id } })).clientId).toBe(
      survivor.id,
    );
  });
});
