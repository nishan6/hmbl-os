import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  createCreditNote,
  creditableLines,
  discardCreditNote,
  issueCreditNote,
} from "@/server/finance/credit-notes";
import {
  createInvoice,
  discardInvoice,
  getInvoice,
  issueInvoice,
  listInvoices,
  recogniseInvoiceRevenue,
  saveInvoiceDraft,
  type InvoiceDraftInput,
} from "@/server/finance/invoices";
import { trialBalance } from "@/server/finance/ledger-reports";
import { updateFinanceSettings } from "@/server/finance/settings";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { taxRate } from "../helpers/commercial";
import { day, giveBooks, journalLines, makeBillableClient, makeBooks } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

async function draft(
  finance: Awaited<ReturnType<typeof makeActor>>,
  entityId: string,
  clientId: string,
  revenueAccountId: string,
  overrides: Partial<InvoiceDraftInput> = {},
) {
  const invoice = await createInvoice(finance, entityId, { clientId });
  const gst18 = await taxRate("GST18");
  await saveInvoiceDraft(finance, invoice.id, {
    invoiceDate: "2026-10-23",
    dueDate: "2026-11-22",
    currency: "INR",
    placeOfSupplyCountry: invoice.placeOfSupplyCountry,
    placeOfSupplyCode: invoice.placeOfSupplyCode,
    lines: [
      {
        description: "LED wall and operator",
        sacCode: "998596",
        quantity: "2",
        unitPrice: "50,000",
        taxRateId: gst18.id,
        revenueAccountId,
      },
    ],
    ...overrides,
  });
  return invoice;
}

describe("issuing an invoice", () => {
  it("charges CGST and SGST within Assam and posts receivable, income and tax", async () => {
    const { entity, account } = await makeBooks();
    const client = await makeBillableClient();
    const finance = await makeActor("finance");
    const invoice = await draft(finance, entity.id, client.id, account("4010").id);
    expect(invoice).toMatchObject({ supplyType: "INTRA_STATE", placeOfSupplyCode: "18" });
    const saved = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(saved).toMatchObject({
      subtotalMinor: 1_00_000_00n,
      cgstMinor: 9_000_00n,
      sgstMinor: 9_000_00n,
      igstMinor: 0n,
      totalMinor: 1_18_000_00n,
    });

    const issued = await issueInvoice(finance, invoice.id);
    expect(issued).toMatchObject({
      status: "ISSUED",
      number: "INV/2627/00001",
      entityGstin: "18AABCH1234K1Z5",
      clientName: `${client.name} Pvt Ltd`,
      baseTotalMinor: 1_18_000_00n,
    });
    expect(await journalLines(issued.journalId!)).toEqual([
      ["1200", 1_18_000_00n, 0n],
      ["4010", 0n, 1_00_000_00n],
      ["2100", 0n, 9_000_00n],
      ["2101", 0n, 9_000_00n],
    ]);
    const receivable = await db.journalLine.findFirstOrThrow({
      where: { journalId: issued.journalId!, debitMinor: { gt: 0n } },
    });
    expect(receivable).toMatchObject({ partyType: "CLIENT", partyId: client.id });
    const tb = await trialBalance(finance, entity.id, day("2026-10-31"));
    expect(tb.balanced).toBe(true);

    await expect(issueInvoice(finance, invoice.id)).rejects.toThrow(ConflictError);
    await expect(
      db.salesInvoice.update({ where: { id: invoice.id }, data: { totalMinor: 1n } }),
    ).rejects.toThrow(/can't be changed/);
    await expect(
      db.salesInvoiceLine.deleteMany({ where: { invoiceId: invoice.id } }),
    ).rejects.toThrow(/can't be changed/);

    const [listed] = await listInvoices(finance, { legalEntityId: entity.id });
    expect(listed).toMatchObject({ outstandingMinor: 1_18_000_00n, creditedMinor: 0n });
  });

  it("charges IGST to a client in another state and needs a place of supply", async () => {
    const { entity, account } = await makeBooks();
    const client = await makeBillableClient({ region: "Maharashtra", gstin: "27AAACM1234B1Z2" });
    const finance = await makeActor("finance");
    const invoice = await draft(finance, entity.id, client.id, account("4000").id);
    expect(invoice).toMatchObject({ supplyType: "INTER_STATE", placeOfSupplyCode: "27" });
    const issued = await issueInvoice(finance, invoice.id);
    expect(await journalLines(issued.journalId!)).toEqual([
      ["1200", 1_18_000_00n, 0n],
      ["4000", 0n, 1_00_000_00n],
      ["2102", 0n, 18_000_00n],
    ]);

    const noState = await makeBillableClient({ region: "Atlantis" });
    const blank = await createInvoice(finance, entity.id, { clientId: noState.id });
    expect(blank.placeOfSupplyCode).toBeNull();
    await expect(
      saveInvoiceDraft(finance, blank.id, {
        invoiceDate: "2026-10-23",
        dueDate: "2026-10-23",
        currency: "INR",
        placeOfSupplyCountry: "IN",
        lines: [
          { description: "x", quantity: "1", unitPrice: "1", revenueAccountId: account("4000").id },
        ],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("converts a foreign-currency export at the invoice's rate", async () => {
    const { entity, account } = await makeBooks();
    const client = await makeBillableClient({ countryCode: "AE", currency: "USD" });
    const finance = await makeActor("finance");
    const invoice = await createInvoice(finance, entity.id, { clientId: client.id });
    expect(invoice).toMatchObject({ supplyType: "EXPORT", currency: "USD" });
    const zero = await taxRate("GST0");
    const input = {
      invoiceDate: "2026-10-23",
      dueDate: "2026-10-23",
      currency: "USD",
      placeOfSupplyCountry: "AE",
      lines: [
        {
          description: "Broadcast package",
          quantity: "1",
          unitPrice: "1000.50",
          taxRateId: zero.id,
          revenueAccountId: account("4030").id,
        },
      ],
    };
    await expect(saveInvoiceDraft(finance, invoice.id, input)).rejects.toThrow(ValidationError);
    await saveInvoiceDraft(finance, invoice.id, {
      ...input,
      fxRate: "83.25",
      fxNote: "RBI 23 Oct",
    });
    const issued = await issueInvoice(finance, invoice.id);
    expect(issued.baseTotalMinor).toBe(83_291_63n);
    const lines = await db.journalLine.findMany({ where: { journalId: issued.journalId! } });
    expect(lines.find((l) => l.debitMinor > 0n)).toMatchObject({
      txCurrency: "USD",
      txAmountMinor: 1000_50n,
      debitMinor: 83_291_63n,
    });
  });

  it("refuses to issue without the entity's GSTIN, and discards drafts", async () => {
    const { entity, account } = await makeBooks({ gstin: null });
    const client = await makeBillableClient({ region: "Maharashtra" });
    const finance = await makeActor("finance");
    const invoice = await draft(finance, entity.id, client.id, account("4000").id);
    await expect(issueInvoice(finance, invoice.id)).rejects.toThrow(/GSTIN/);
    await discardInvoice(finance, invoice.id);
    expect(await listInvoices(finance, { legalEntityId: entity.id })).toEqual([]);
  });

  it("is for Finance: sales and viewers can't draft or issue", async () => {
    const { entity, account } = await makeBooks();
    const client = await makeBillableClient();
    const sales = await makeActor("sales");
    const viewer = await makeActor("viewer");
    await expect(createInvoice(sales, entity.id, { clientId: client.id })).rejects.toThrow(
      ForbiddenError,
    );
    const finance = await makeActor("finance");
    const invoice = await draft(finance, entity.id, client.id, account("4000").id);
    await expect(issueInvoice(viewer, invoice.id)).rejects.toThrow(ForbiddenError);
    expect((await getInvoice(viewer, invoice.id)).actions.issue).toBe(false);
  });
});

describe("billing milestones", () => {
  it("drafts the milestone's share of the contract value for the project's client", async () => {
    const { project } = await makeAcceptedProject();
    await giveBooks(project.legalEntityId);
    const finance = await makeActor("finance");
    const milestone = await db.projectMilestone.findFirstOrThrow({
      where: { projectId: project.id, position: 1 },
    });
    const invoice = await createInvoice(finance, project.legalEntityId, {
      clientId: project.clientId!,
      projectId: project.id,
      milestoneId: milestone.id,
    });
    const lines = await db.salesInvoiceLine.findMany({ where: { invoiceId: invoice.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amountMinor: 70_000_00n, taxRateBps: 1800 });
    expect(invoice.totalMinor).toBe(82_600_00n);
    expect(invoice.milestoneId).toBe(milestone.id);

    const other = await makeBillableClient();
    await expect(
      createInvoice(finance, project.legalEntityId, { clientId: other.id, projectId: project.id }),
    ).rejects.toMatchObject({
      fieldErrors: { projectId: [expect.stringMatching(/another client/)] },
    });
  });
});

describe("credit notes", () => {
  async function issued() {
    const { entity, account } = await makeBooks();
    const client = await makeBillableClient();
    const finance = await makeActor("finance");
    const invoice = await draft(finance, entity.id, client.id, account("4010").id);
    await issueInvoice(finance, invoice.id);
    const [line] = await creditableLines(finance, invoice.id);
    return { entity, finance, invoice, line: line! };
  }

  it("reverses part of a line with its tax and reduces what is outstanding", async () => {
    const { entity, finance, invoice, line } = await issued();
    const note = await createCreditNote(finance, invoice.id, {
      date: "2026-10-25",
      reason: "One day of LED cancelled",
      lines: [{ invoiceLineId: line.id, amount: "20000" }],
    });
    expect(note).toMatchObject({
      cgstMinor: 1_800_00n,
      sgstMinor: 1_800_00n,
      totalMinor: 23_600_00n,
    });
    const done = await issueCreditNote(finance, note.id);
    expect(done.number).toBe("CN/2627/00001");
    expect(await journalLines(done.journalId!)).toEqual([
      ["1200", 0n, 23_600_00n],
      ["4010", 20_000_00n, 0n],
      ["2100", 1_800_00n, 0n],
      ["2101", 1_800_00n, 0n],
    ]);
    const view = await getInvoice(finance, invoice.id);
    expect(view).toMatchObject({ creditedMinor: 23_600_00n, outstandingMinor: 94_400_00n });
    const [after] = await creditableLines(finance, invoice.id);
    expect(after!.remainingMinor).toBe(80_000_00n);
    expect((await trialBalance(finance, entity.id, day("2026-10-31"))).balanced).toBe(true);
  });

  it("never credits more than is left, even when two drafts race", async () => {
    const { finance, invoice, line } = await issued();
    await expect(
      createCreditNote(finance, invoice.id, {
        date: "2026-10-25",
        reason: "Too much",
        lines: [{ invoiceLineId: line.id, amount: "100000.01" }],
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createCreditNote(finance, invoice.id, {
        date: "2026-10-01",
        reason: "Before the invoice",
        lines: [{ invoiceLineId: line.id, amount: "1" }],
      }),
    ).rejects.toThrow(ValidationError);
    const first = await createCreditNote(finance, invoice.id, {
      date: "2026-10-25",
      reason: "First",
      lines: [{ invoiceLineId: line.id, amount: "60000" }],
    });
    const second = await createCreditNote(finance, invoice.id, {
      date: "2026-10-25",
      reason: "Second",
      lines: [{ invoiceLineId: line.id, amount: "60000" }],
    });
    await issueCreditNote(finance, first.id);
    await expect(issueCreditNote(finance, second.id)).rejects.toThrow(/already been credited/);
    await discardCreditNote(finance, second.id);
    expect((await getInvoice(finance, invoice.id)).outstandingMinor).toBe(47_200_00n);
  });
});

describe("revenue recognised on completion", () => {
  it("holds invoiced revenue as client advances until the project is completed", async () => {
    const { project } = await makeAcceptedProject();
    await giveBooks(project.legalEntityId);
    await db.client.update({ where: { id: project.clientId! }, data: { region: "Maharashtra" } });
    const owner = await makeActor("owner");
    await updateFinanceSettings(owner, project.legalEntityId, {
      revenueRecognition: "ON_COMPLETION",
    });
    const milestone = await db.projectMilestone.findFirstOrThrow({
      where: { projectId: project.id, position: 1 },
    });
    const invoice = await createInvoice(owner, project.legalEntityId, {
      clientId: project.clientId!,
      projectId: project.id,
      milestoneId: milestone.id,
    });
    const issued = await issueInvoice(owner, invoice.id);
    expect(issued.revenueDeferred).toBe(true);
    expect(await journalLines(issued.journalId!)).toEqual([
      ["1200", 82_600_00n, 0n],
      ["2300", 0n, 70_000_00n],
      ["2102", 0n, 12_600_00n],
    ]);
    expect((await getInvoice(owner, invoice.id)).actions.recognise).toBe(false);
    await expect(recogniseInvoiceRevenue(owner, invoice.id)).rejects.toThrow(/completed/);

    const [line] = await creditableLines(owner, invoice.id);
    const note = await createCreditNote(owner, invoice.id, {
      date: new Date().toISOString().slice(0, 10),
      reason: "Discount",
      lines: [{ invoiceLineId: line!.id, amount: "10000" }],
    });
    const credit = await issueCreditNote(owner, note.id);
    expect((await journalLines(credit.journalId!))[1]).toEqual(["2300", 10_000_00n, 0n]);

    await db.project.update({ where: { id: project.id }, data: { status: "COMPLETED" } });
    const recognised = await recogniseInvoiceRevenue(owner, invoice.id);
    expect(await journalLines(recognised.recognitionJournalId!)).toEqual([
      ["2300", 60_000_00n, 0n],
      ["4000", 0n, 60_000_00n],
    ]);
    await expect(recogniseInvoiceRevenue(owner, invoice.id)).rejects.toThrow(ConflictError);
  });
});
