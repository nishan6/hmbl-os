import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  approveBill,
  createBill,
  discardBill,
  getBill,
  rejectBill,
  saveBillDraft,
  submitBill,
  voidBill,
} from "@/server/finance/bills";
import { trialBalance } from "@/server/finance/ledger-reports";
import { payablesAgeing, tdsPayableReport } from "@/server/finance/payables";
import {
  allocatePayment,
  getPayment,
  openBills,
  recordPayment,
  voidPayment,
  type PaymentInput,
} from "@/server/finance/payments";
import { getProjectBudget, voidCostEntry } from "@/server/projects/budget";
import { createVendor, getVendor, updateVendor } from "@/server/vendors/service";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { taxRate } from "../helpers/commercial";
import {
  day,
  draftBill,
  giveBooks,
  journalLines,
  makeBankAccount,
  makeBooks,
  makeVendor,
} from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

async function setup() {
  const books = await makeBooks();
  const finance = await makeActor("finance");
  return { ...books, finance };
}

/** Drafts, submits and approves a bill. */
async function approvedBill(...args: Parameters<typeof draftBill>) {
  const [actor] = args;
  const bill = await draftBill(...args);
  await submitBill(actor, bill.id);
  return approveBill(actor, bill.id);
}

const payment = (
  vendorId: string,
  paidFromId: string,
  overrides: Partial<PaymentInput> = {},
): PaymentInput => ({
  vendorId,
  paidFromId,
  date: "2026-10-25",
  method: "BANK_TRANSFER",
  reference: "UTR987",
  currency: "INR",
  amount: "0",
  allocations: [],
  ...overrides,
});

async function balance(entityId: string, code: string, asAt = day("2026-12-31")) {
  const owner = await makeActor("owner");
  const tb = await trialBalance(owner, entityId, asAt);
  const row = tb.rows.find((r) => r.account.code === code);
  return row ? row.debitMinor - row.creditMinor : 0n;
}

describe("vendors", () => {
  it("takes the PAN from the GSTIN and checks the two agree", async () => {
    const owner = await makeActor("owner");
    const vendor = await createVendor(owner, {
      name: "Brahmaputra Lights",
      countryCode: "IN",
      currency: "INR",
      gstin: "18aaacv1234f1z9",
      paymentTermsDays: "30",
      tdsSection: "194c",
      tdsRate: "2",
      bankIfsc: "sbin0001234",
    });
    expect(vendor).toMatchObject({
      gstin: "18AAACV1234F1Z9",
      pan: "AAACV1234F",
      tdsSection: "194C",
      tdsRateBps: 200,
      bankIfsc: "SBIN0001234",
    });
    await expect(
      updateVendor(owner, vendor.id, {
        name: vendor.name,
        countryCode: "IN",
        currency: "INR",
        gstin: "18AAACV1234F1Z9",
        pan: "AAACX9999X",
        paymentTermsDays: "30",
      }),
    ).rejects.toMatchObject({ fieldErrors: { pan: [expect.any(String)] } });
    await expect(
      createVendor(owner, {
        name: "Bad",
        countryCode: "IN",
        currency: "INR",
        gstin: "99XYZ",
        paymentTermsDays: "30",
      }),
    ).rejects.toMatchObject({ fieldErrors: { gstin: [expect.any(String)] } });
    await expect(getVendor(await makeActor("sales"), vendor.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("approving a bill", () => {
  it("posts expense, input GST, TDS payable and the vendor's payable within the state", async () => {
    const { entity, finance } = await setup();
    const vendor = await makeVendor({ tdsSection: "194C", tdsRate: "2" });
    const draft = await draftBill(finance, entity.id, vendor.id, {
      tdsSection: "194C",
      tdsRate: "2",
    });
    expect(draft).toMatchObject({
      supplyType: "INTRA_STATE",
      subtotalMinor: 50_000_00n,
      cgstMinor: 4_500_00n,
      sgstMinor: 4_500_00n,
      totalMinor: 59_000_00n,
      tdsMinor: 1_000_00n,
      payableMinor: 58_000_00n,
      number: null,
    });
    await submitBill(finance, draft.id);
    const bill = await approveBill(finance, draft.id);
    expect(bill.number).toMatch(/^VB\/.+\/00001$/);
    expect(bill.basePayableMinor).toBe(58_000_00n);
    expect(await journalLines(bill.journalId!)).toEqual([
      ["2000", 0n, 58_000_00n],
      ["5010", 50_000_00n, 0n],
      ["1310", 4_500_00n, 0n],
      ["1311", 4_500_00n, 0n],
      ["2200", 0n, 1_000_00n],
    ]);
    const journal = await db.journal.findUniqueOrThrow({
      where: { id: bill.journalId! },
      include: { lines: { where: { account: { code: "2000" } } } },
    });
    expect(journal).toMatchObject({ source: "VENDOR_BILL", sourceRef: bill.number });
    expect(journal.lines[0]).toMatchObject({ partyType: "VENDOR", partyId: vendor.id });
  });

  it("charges GST that can't be claimed to the expense, and IGST from another state", async () => {
    const { entity, finance } = await setup();
    const vendor = await makeVendor({ gstin: "27AAACM1234F1Z1" });
    const office = await db.ledgerAccount.findFirstOrThrow({
      where: { legalEntityId: entity.id, code: "6070" },
    });
    const bill = await approvedBill(finance, entity.id, vendor.id, {
      lines: [
        { unitPrice: "20000" },
        { description: "Staff lunch", unitPrice: "1000", itcEligible: false, accountId: office.id },
      ],
    });
    expect(bill).toMatchObject({ supplyType: "INTER_STATE", igstMinor: 3_780_00n });
    expect(await journalLines(bill.journalId!)).toEqual([
      ["2000", 0n, 24_780_00n],
      ["5010", 20_000_00n, 0n],
      ["6070", 1_180_00n, 0n],
      ["1312", 3_600_00n, 0n],
    ]);
  });

  it("books a foreign supplier's bill at its rate, without GST or TDS", async () => {
    const { entity, finance } = await setup();
    const vendor = await makeVendor({ gstin: null, countryCode: "AE", currency: "USD" });
    await expect(
      draftBill(finance, entity.id, vendor.id, {
        currency: "USD",
        fxRate: "83.25",
        tdsSection: "194J",
        tdsRate: "10",
        lines: [{ unitPrice: "1000", taxRateId: null }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { tdsRate: [expect.any(String)] } });
    const bill = await approvedBill(finance, entity.id, vendor.id, {
      currency: "USD",
      fxRate: "83.25",
      lines: [{ unitPrice: "1000", taxRateId: null }],
    });
    expect(bill).toMatchObject({ supplyType: "EXPORT", payableMinor: 1_000_00n });
    expect(bill.basePayableMinor).toBe(83_250_00n);
    expect(await journalLines(bill.journalId!)).toEqual([
      ["2000", 0n, 83_250_00n],
      ["5010", 83_250_00n, 0n],
    ]);
  });

  it("refuses the same supplier invoice twice", async () => {
    const { entity, finance } = await setup();
    const vendor = await makeVendor();
    await approvedBill(finance, entity.id, vendor.id, { vendorInvoiceNumber: "LT/1001" });
    const again = await draftBill(finance, entity.id, vendor.id, {
      vendorInvoiceNumber: "lt/1001",
    });
    await expect(submitBill(finance, again.id)).rejects.toThrow(/already entered as VB/);
    // Another vendor's invoice can share the number.
    const other = await makeVendor();
    const fine = await draftBill(finance, entity.id, other.id, { vendorInvoiceNumber: "LT/1001" });
    await expect(submitBill(finance, fine.id)).resolves.toMatchObject({ status: "SUBMITTED" });
  });

  it("holds MSME suppliers to 45 days", async () => {
    const { entity, finance } = await setup();
    const vendor = await makeVendor({ msmeNumber: "UDYAM-AS-01-0001234", paymentTermsDays: "60" });
    const bill = await createBill(finance, entity.id, { vendorId: vendor.id });
    expect((bill.dueDate.getTime() - bill.billDate.getTime()) / 86_400_000).toBe(45);
    await expect(
      draftBill(finance, entity.id, vendor.id, { billDate: "2026-10-01", dueDate: "2026-11-20" }),
    ).rejects.toMatchObject({ fieldErrors: { dueDate: [expect.stringMatching(/MSME/)] } });
  });

  it("goes back to draft when rejected, and a draft can be discarded", async () => {
    const { entity, finance } = await setup();
    const vendor = await makeVendor();
    const bill = await draftBill(finance, entity.id, vendor.id);
    await expect(approveBill(finance, bill.id)).rejects.toThrow(ConflictError);
    await submitBill(finance, bill.id);
    await expect(
      saveBillDraft(finance, bill.id, {
        vendorInvoiceNumber: "X",
        billDate: "2026-10-05",
        dueDate: "2026-10-05",
        currency: "INR",
        supplyType: "INTRA_STATE",
        lines: [],
      }),
    ).rejects.toThrow();
    const rejected = await rejectBill(finance, bill.id, { reason: "Wrong rate" });
    expect(rejected).toMatchObject({ status: "DRAFT", rejectedReason: "Wrong rate" });
    await discardBill(finance, bill.id);
    await expect(submitBill(finance, bill.id)).rejects.toThrow(ConflictError);
  });

  it("refuses changes to an approved bill in the database", async () => {
    const { entity, finance } = await setup();
    const vendor = await makeVendor();
    const bill = await approvedBill(finance, entity.id, vendor.id);
    await expect(
      db.vendorBill.update({ where: { id: bill.id }, data: { totalMinor: 1n } }),
    ).rejects.toThrow(/can't be changed/);
    const [line] = await db.vendorBillLine.findMany({ where: { billId: bill.id } });
    await expect(
      db.vendorBillLine.update({ where: { id: line!.id }, data: { description: "Edited" } }),
    ).rejects.toThrow(/can't be changed/);
    await expect(db.vendorBill.delete({ where: { id: bill.id } })).rejects.toThrow();
  });
});

describe("bills for projects", () => {
  async function projectSetup() {
    const { entity, project } = await makeAcceptedProject();
    await giveBooks(entity.id);
    const pm = await makeActor("project_manager");
    await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
    const finance = await makeActor("finance");
    const [budgetLine] = await db.projectBudgetLine.findMany({
      where: { projectId: project.id },
      orderBy: { position: "asc" },
    });
    return { entity, project, pm, finance, budgetLine: budgetLine! };
  }

  it("lets the project manager approve and records the cost against the budget", async () => {
    const { entity, project, pm, finance, budgetLine } = await projectSetup();
    const vendor = await makeVendor();
    const bill = await draftBill(finance, entity.id, vendor.id, {
      lines: [{ unitPrice: "30000", projectId: project.id, budgetLineId: budgetLine.id }],
    });
    await expect(getBill(pm, bill.id)).rejects.toThrow(NotFoundError);
    await submitBill(finance, bill.id);
    const seen = await getBill(pm, bill.id);
    expect(seen.actions).toMatchObject({ approve: true, reject: true, pay: false, edit: false });
    await expect(approveBill(await makeActor("project_manager"), bill.id)).rejects.toThrow(
      NotFoundError,
    );
    await expect(approveBill(await makeActor("sales"), bill.id)).rejects.toThrow(NotFoundError);
    const approved = await approveBill(pm, bill.id);
    expect(approved.approvedById).toBe(pm.id);

    const owner = await makeActor("owner");
    const budget = await getProjectBudget(owner, project.id);
    expect(budget.totals.actualMinor).toBe(30_000_00n);
    const [entry] = await db.projectCostEntry.findMany({ where: { projectId: project.id } });
    expect(entry).toMatchObject({
      kind: "ACTUAL",
      amountMinor: 30_000_00n,
      sourceType: "vendor_bill_line",
      supplier: vendor.name,
    });
    const journalLine = await db.journalLine.findFirstOrThrow({
      where: { journalId: approved.journalId!, account: { code: "5010" } },
    });
    expect(journalLine.projectId).toBe(project.id);
    // The cost can only be undone through the bill.
    await expect(voidCostEntry(owner, entry!.id, { reason: "x" })).rejects.toThrow(ConflictError);

    await voidBill(finance, bill.id, { date: "2026-10-31", reason: "Duplicate of a later bill" });
    expect((await getProjectBudget(owner, project.id)).totals.actualMinor).toBe(0n);
    expect(await balance(entity.id, "2000")).toBe(0n);
    expect(await balance(entity.id, "5010")).toBe(0n);
  });

  it("needs Finance to approve when a line isn't the manager's project", async () => {
    const { entity, project, pm, finance, budgetLine } = await projectSetup();
    const vendor = await makeVendor();
    const bill = await draftBill(finance, entity.id, vendor.id, {
      lines: [{ projectId: project.id, budgetLineId: budgetLine.id }, { unitPrice: "100" }],
    });
    await submitBill(finance, bill.id);
    await expect(approveBill(pm, bill.id)).rejects.toThrow(NotFoundError);
    await expect(approveBill(finance, bill.id)).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("asks for the budget line of a project line", async () => {
    const { entity, project, finance } = await projectSetup();
    const vendor = await makeVendor();
    await expect(
      draftBill(finance, entity.id, vendor.id, { lines: [{ projectId: project.id }] }),
    ).rejects.toMatchObject({ fieldErrors: { "lines.0.budgetLineId": [expect.any(String)] } });
  });
});

describe("paying vendors", () => {
  it("pays a bill in full and closes it", async () => {
    const { entity, finance } = await setup();
    const bank = await makeBankAccount(entity.id);
    const vendor = await makeVendor({ tdsSection: "194C", tdsRate: "2" });
    const bill = await approvedBill(finance, entity.id, vendor.id, {
      tdsSection: "194C",
      tdsRate: "2",
    });
    expect((await getBill(finance, bill.id)).actions.pay).toBe(true);
    const paid = await recordPayment(
      finance,
      entity.id,
      payment(vendor.id, bank.ledgerAccountId, {
        amount: "58,000",
        allocations: [{ billId: bill.id, amount: "58000" }],
      }),
    );
    expect(paid.number).toMatch(/^PAY\//);
    expect(await journalLines(paid.journalId)).toEqual([
      ["2000", 58_000_00n, 0n],
      ["1100", 0n, 58_000_00n],
    ]);
    const after = await getBill(finance, bill.id);
    expect(after).toMatchObject({ paidMinor: 58_000_00n, outstandingMinor: 0n });
    expect(after.actions).toMatchObject({ pay: false, void: false });
    await expect(voidBill(finance, bill.id, { date: "2026-10-31", reason: "x" })).rejects.toThrow(
      /Void those payments first/,
    );
    expect(await openBills(finance, entity.id, vendor.id)).toEqual([]);
    expect(await balance(entity.id, "2000")).toBe(0n);
  });

  it("keeps money paid ahead as an advance and sets it against a bill later", async () => {
    const { entity, finance } = await setup();
    const bank = await makeBankAccount(entity.id);
    const vendor = await makeVendor();
    const advance = await recordPayment(
      finance,
      entity.id,
      payment(vendor.id, bank.ledgerAccountId, { amount: "20000", date: "2026-10-02" }),
    );
    expect(await journalLines(advance.journalId)).toEqual([
      ["2000", 20_000_00n, 0n],
      ["1100", 0n, 20_000_00n],
    ]);
    const bill = await approvedBill(finance, entity.id, vendor.id);
    const ageing = await payablesAgeing(finance, entity.id, day("2026-10-10"));
    expect(ageing.totals).toMatchObject({ advanceMinor: 20_000_00n, totalMinor: 39_000_00n });
    expect(ageing.ledgerMinor).toBe(39_000_00n);

    await expect(
      allocatePayment(finance, advance.id, { allocations: [{ billId: bill.id, amount: "25000" }] }),
    ).rejects.toMatchObject({ fieldErrors: { "allocations.0.amount": [expect.any(String)] } });
    await allocatePayment(finance, advance.id, {
      date: "2026-10-10",
      allocations: [{ billId: bill.id, amount: "20000" }],
    });
    const p = await getPayment(finance, advance.id);
    expect(p).toMatchObject({ unallocatedMinor: 0n });
    expect(p.actions.allocate).toBe(false);
    expect((await getBill(finance, bill.id)).outstandingMinor).toBe(39_000_00n);
    const later = await payablesAgeing(finance, entity.id, day("2026-10-10"));
    expect(later.totals.totalMinor).toBe(later.ledgerMinor);
  });

  it("reopens the bill when a payment is voided", async () => {
    const { entity, finance } = await setup();
    const bank = await makeBankAccount(entity.id);
    const vendor = await makeVendor();
    const bill = await approvedBill(finance, entity.id, vendor.id);
    const paid = await recordPayment(
      finance,
      entity.id,
      payment(vendor.id, bank.ledgerAccountId, {
        amount: "59000",
        allocations: [{ billId: bill.id, amount: "59000" }],
      }),
    );
    await voidPayment(finance, paid.id, { date: "2026-10-28", reason: "Returned by the bank" });
    expect((await getBill(finance, bill.id)).outstandingMinor).toBe(59_000_00n);
    expect(await balance(entity.id, "1100")).toBe(0n);
    expect(await balance(entity.id, "2000")).toBe(-59_000_00n);
    // Before the void the bill was paid; after it, owed again.
    const before = await payablesAgeing(finance, entity.id, day("2026-10-26"));
    expect(before.totals.totalMinor).toBe(0n);
    expect(before.ledgerMinor).toBe(0n);
    const afterVoid = await payablesAgeing(finance, entity.id, day("2026-10-28"));
    expect(afterVoid.totals.totalMinor).toBe(59_000_00n);
    expect(afterVoid.ledgerMinor).toBe(59_000_00n);
    await expect(
      voidPayment(finance, paid.id, { date: "2026-10-29", reason: "again" }),
    ).rejects.toThrow(ConflictError);
  });

  it("posts the exchange difference when a foreign bill is paid at another rate", async () => {
    const { entity, finance } = await setup();
    const usd = await makeBankAccount(entity.id, "USD");
    const vendor = await makeVendor({ gstin: null, countryCode: "AE", currency: "USD" });
    const bill = await approvedBill(finance, entity.id, vendor.id, {
      currency: "USD",
      fxRate: "83",
      lines: [{ unitPrice: "1000", taxRateId: null }],
    });
    const paid = await recordPayment(
      finance,
      entity.id,
      payment(vendor.id, usd.ledgerAccountId, {
        currency: "USD",
        fxRate: "84",
        amount: "1000",
        allocations: [{ billId: bill.id, amount: "1000" }],
      }),
    );
    // Paying cost ₹84,000 for a bill booked at ₹83,000: a ₹1,000 loss.
    expect(await journalLines(paid.journalId)).toEqual([
      ["2000", 83_000_00n, 0n],
      ["1100", 0n, 84_000_00n],
      ["6100", 1_000_00n, 0n],
    ]);
    expect(await balance(entity.id, "2000")).toBe(0n);
  });

  it("refuses to pay another vendor's bill, overpay, or pay in another currency", async () => {
    const { entity, finance } = await setup();
    const bank = await makeBankAccount(entity.id);
    const vendor = await makeVendor();
    const other = await makeVendor();
    const bill = await approvedBill(finance, entity.id, vendor.id);
    const base = payment(other.id, bank.ledgerAccountId, { amount: "1000" });
    await expect(
      recordPayment(finance, entity.id, {
        ...base,
        allocations: [{ billId: bill.id, amount: "1000" }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "allocations.0.amount": [expect.any(String)] } });
    await expect(
      recordPayment(finance, entity.id, {
        ...payment(vendor.id, bank.ledgerAccountId),
        amount: "60000",
        allocations: [{ billId: bill.id, amount: "60000" }],
      }),
    ).rejects.toMatchObject({ fieldErrors: { "allocations.0.amount": [expect.any(String)] } });
    await expect(
      recordPayment(await makeActor("project_manager"), entity.id, base),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses an over-allocation in the database", async () => {
    const { entity, finance } = await setup();
    const bank = await makeBankAccount(entity.id);
    const vendor = await makeVendor();
    const bill = await approvedBill(finance, entity.id, vendor.id);
    const p = await recordPayment(
      finance,
      entity.id,
      payment(vendor.id, bank.ledgerAccountId, { amount: "100000" }),
    );
    await expect(
      db.vendorPaymentAllocation.create({
        data: {
          paymentId: p.id,
          billId: bill.id,
          date: day("2026-10-25"),
          amountMinor: 60_000_00n,
          billBaseMinor: 60_000_00n,
          paymentBaseMinor: 60_000_00n,
          createdById: finance.id,
        },
      }),
    ).rejects.toThrow(/overpaid/);
    await expect(
      db.vendorPayment.update({ where: { id: p.id }, data: { amountMinor: 1n } }),
    ).rejects.toThrow(/can't be changed/);
  });
});

describe("TDS payable", () => {
  it("lists deductions by month and section with the deposit date", async () => {
    const { entity, finance } = await setup();
    const contractor = await makeVendor({ tdsSection: "194C", tdsRate: "2" });
    const consultant = await makeVendor({ gstin: null, pan: "ABCPK1234L" });
    const noPan = await makeVendor({ gstin: null });
    await approvedBill(finance, entity.id, contractor.id, {
      billDate: "2026-10-05",
      tdsSection: "194C",
      tdsRate: "2",
    });
    await approvedBill(finance, entity.id, consultant.id, {
      billDate: "2026-10-20",
      supplyType: "INTRA_STATE",
      tdsSection: "194J",
      tdsRate: "10",
      lines: [{ unitPrice: "12345.60", taxRateId: (await taxRate("GST18")).id }],
    });
    await approvedBill(finance, entity.id, noPan.id, {
      billDate: "2026-11-02",
      dueDate: "2026-11-30",
      tdsSection: "194J",
      tdsRate: "20",
      lines: [{ unitPrice: "1000", taxRateId: null }],
    });
    const voided = await approvedBill(finance, entity.id, contractor.id, {
      billDate: "2026-10-06",
      tdsSection: "194C",
      tdsRate: "2",
    });
    await voidBill(finance, voided.id, { date: "2026-10-07", reason: "Entered twice" });

    const report = await tdsPayableReport(finance, entity.id, {
      from: day("2026-10-01"),
      to: day("2026-11-30"),
    });
    expect(
      report.months.map((m) => [
        m.month,
        m.depositDue.toISOString().slice(0, 10),
        m.sections.map((s) => [s.section, s.taxableMinor, s.tdsMinor]),
      ]),
    ).toEqual([
      [
        "2026-10",
        "2026-11-07",
        [
          ["194C", 50_000_00n, 1_000_00n],
          // 10% of 12,345.60 is 1,234.56, rounded to the rupee.
          ["194J", 12_345_60n, 1_235_00n],
        ],
      ],
      ["2026-11", "2026-12-07", [["194J", 1_000_00n, 200_00n]]],
    ]);
    expect(report.totalMinor).toBe(2_435_00n);
    expect(report.ledgerMinor).toBe(2_435_00n);
    expect(report.deductions.find((d) => d.vendor.id === noPan.id)?.missingPan).toBe(true);
  });
});
