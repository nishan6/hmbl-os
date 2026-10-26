import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { approveBill, submitBill } from "@/server/finance/bills";
import { financeDashboard } from "@/server/finance/dashboard";
import { createJournal, discardJournal } from "@/server/finance/journals";
import { postJournal } from "@/server/finance/ledger";
import { trialBalance } from "@/server/finance/ledger-reports";
import { closePeriod, getPeriodClose, reopenPeriod } from "@/server/finance/period-close";
import { ensurePeriod } from "@/server/finance/periods";
import { recordReceipt } from "@/server/finance/receipts";
import { reportCsv } from "@/server/finance/report-export";
import {
  balanceSheet,
  cashFlow,
  profitAndLoss,
  projectProfitability,
  taxSummary,
} from "@/server/finance/statements";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import {
  day,
  draftBill,
  giveBooks,
  issueSimpleInvoice,
  makeBankAccount,
  makeBillableClient,
  makeBooks,
  makeVendor,
} from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

type Books = Awaited<ReturnType<typeof makeBooks>>;

/** Posts a two-line manual journal: rupees from `credit` to `debit`. */
async function move(
  books: Books,
  date: string,
  debit: string,
  credit: string,
  rupees: number,
  projectId?: string,
) {
  const accountId = async (code: string) => (code.length === 36 ? code : books.account(code).id);
  const minor = BigInt(rupees) * 100n;
  return db.$transaction(async (tx) =>
    postJournal(tx, "system", {
      legalEntityId: books.entity.id,
      date: day(date),
      source: "MANUAL",
      narration: `${debit} from ${credit}`,
      lines: [
        { accountId: await accountId(debit), debitMinor: minor, projectId },
        { accountId: await accountId(credit), creditMinor: minor, projectId },
      ],
    }),
  );
}

/**
 * October 2026: ₹2,00,000 capital in; a ₹1,00,000 + 18% GST invoice paid in
 * full; a ₹50,000 + 18% GST bill approved, unpaid; ₹500 bank charges. And
 * ₹1,000 of other income in March 2026, the year before.
 */
async function october() {
  const books = await makeBooks();
  const finance = await makeActor("finance");
  const bank = await makeBankAccount(books.entity.id);
  await move(books, "2026-03-15", bank.ledgerAccountId, "4900", 1_000);
  await move(books, "2026-10-02", bank.ledgerAccountId, "3000", 200_000);
  const client = await makeBillableClient();
  const invoice = await issueSimpleInvoice(finance, books.entity.id, client.id);
  await recordReceipt(finance, books.entity.id, {
    clientId: client.id,
    depositAccountId: bank.ledgerAccountId,
    date: "2026-10-20",
    method: "BANK_TRANSFER",
    reference: "UTR9",
    currency: "INR",
    amount: "118000",
    allocations: [{ invoiceId: invoice.id, amount: "118000" }],
  });
  const vendor = await makeVendor();
  const bill = await draftBill(finance, books.entity.id, vendor.id);
  await submitBill(finance, bill.id);
  await approveBill(finance, bill.id);
  await move(books, "2026-10-25", "6050", bank.ledgerAccountId, 500);
  return { ...books, finance, bank };
}

const oct = { from: day("2026-10-01"), to: day("2026-10-31") };

describe("financial statements", () => {
  it("profit and loss, balance sheet and cash flow agree with each other and the trial balance", async () => {
    const s = await october();

    const pl = await profitAndLoss(s.finance, s.entity.id, oct, {
      compare: { from: day("2026-09-01"), to: day("2026-09-30") },
    });
    expect(pl.revenue.totalMinor).toBe(100_000_00n);
    expect(pl.direct.totalMinor).toBe(50_000_00n);
    expect(pl.gross).toEqual({ amountMinor: 50_000_00n, compareMinor: 0n });
    expect(pl.operating.rows.map((r) => [r.account.code, r.amountMinor])).toEqual([
      ["6050", 500_00n],
    ]);
    expect(pl.net).toEqual({ amountMinor: 49_500_00n, compareMinor: 0n });

    const bs = await balanceSheet(s.finance, s.entity.id, day("2026-10-31"));
    expect(bs.assetsMinor).toBe(327_500_00n); // bank 3,18,500 + input GST 9,000
    expect(bs.liabilitiesMinor).toBe(77_000_00n); // payables 59,000 + output GST 18,000
    expect(bs.earlierProfitMinor).toBe(1_000_00n);
    expect(bs.yearProfitMinor).toBe(49_500_00n);
    expect(bs.equityMinor).toBe(250_500_00n);
    expect(bs.balanced).toBe(true);
    expect(bs.fiscalYear.label).toBe("2026-27");

    const tb = await trialBalance(s.finance, s.entity.id, day("2026-10-31"));
    const bankRow = tb.rows.find((r) => r.account.code === "1100")!;
    expect(bs.assets[0]!.totalMinor).toBe(bankRow.debitMinor);

    const cf = await cashFlow(s.finance, s.entity.id, oct);
    expect(cf.openingMinor).toBe(1_000_00n);
    const flows = Object.fromEntries(
      cf.activities.map((a) => [a.key, a.rows.map((r) => [r.account.code, r.amountMinor])]),
    );
    expect(flows).toEqual({
      OPERATING: [
        ["1200", 118_000_00n],
        ["6050", -500_00n],
      ],
      INVESTING: [],
      FINANCING: [["3000", 200_000_00n]],
    });
    expect(cf.closingMinor).toBe(318_500_00n);
    expect(cf.agrees).toBe(true);
  });

  it("summarises GST charged and claimed by month", async () => {
    const s = await october();
    const tax = await taxSummary(s.finance, s.entity.id, oct);
    expect(tax.rows.map((r) => r.month)).toEqual(["2026-10"]);
    expect(tax.totals).toMatchObject({
      outputMinor: 18_000_00n,
      inputMinor: 9_000_00n,
      netGstMinor: 9_000_00n,
    });
    const cgst = tax.sections.output.find((a) => a.systemKey === "OUTPUT_CGST")!;
    expect(tax.accountTotals.get(cgst.id)).toBe(9_000_00n);
  });

  it("shows revenue, costs and margin per project, and a project's own profit and loss", async () => {
    const { entity, project } = await makeAcceptedProject();
    const books = await giveBooks(entity.id);
    const finance = await makeActor("finance");
    await move(books, "2026-10-03", "1000", "4000", 80_000, project.id);
    await move(books, "2026-10-04", "5000", "1000", 30_000, project.id);
    await move(books, "2026-10-05", "6010", "1000", 10_000);
    const report = await projectProfitability(finance, entity.id, oct);
    expect(report.rows).toEqual([
      expect.objectContaining({
        project: expect.objectContaining({ id: project.id }),
        revenueMinor: 80_000_00n,
        costMinor: 30_000_00n,
        marginMinor: 50_000_00n,
        marginBps: 6_250,
      }),
    ]);
    const pl = await profitAndLoss(finance, entity.id, oct, { projectId: project.id });
    expect(pl.net.amountMinor).toBe(50_000_00n);
    expect(pl.operating.rows).toHaveLength(0);
  });

  it("downloads as CSV for the accountant, with reports.export", async () => {
    const s = await october();
    const pl = await reportCsv(s.finance, "profit-and-loss", {
      entity: s.entity.id,
      from: "2026-10-01",
      to: "2026-10-31",
      compare: "year",
    });
    expect(pl.fileName).toBe(`${s.entity.code}_profit-and-loss_2026-10-01_2026-10-31.csv`);
    const lines = pl.csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "Section,Code,Account,2026-10-01 to 2026-10-31 (INR),2025-10-01 to 2025-10-31",
    );
    expect(lines).toContain("Total revenue,,,100000.00,0.00");
    expect(lines).toContain("Operating expenses,6050,Bank charges,500.00,0.00");
    expect(lines.at(-1)).toBe("Net profit,,,49500.00,0.00");

    const bs = await reportCsv(s.finance, "balance-sheet", {
      entity: s.entity.id,
      asAt: "2026-10-31",
    });
    expect(bs.csv).toContain("Total assets,,,327500.00");
    const tb = await reportCsv(s.finance, "trial-balance", {
      entity: s.entity.id,
      asAt: "2026-10-31",
    });
    expect(tb.csv.trim().split("\r\n").at(-1)).toMatch(/^Totals,,,(\d+\.\d\d),\1$/);

    await expect(reportCsv(s.finance, "salaries", { entity: s.entity.id })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      reportCsv(await makeActor("project_manager"), "balance-sheet", { entity: s.entity.id }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("downloads the day book with every posted journal line and its party", async () => {
    const s = await october();
    const book = await reportCsv(s.finance, "day-book", {
      entity: s.entity.id,
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(book.fileName).toBe(`${s.entity.code}_day-book_2026-10-01_2026-10-31.csv`);
    const lines = book.csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "Date,Journal,Source,Reference,Narration,Line,Code,Account,Debit (INR),Credit (INR),Party type,Party,Project,Description",
    );
    // March's journal is outside the dates.
    expect(lines.some((l) => l.startsWith("2026-03-15"))).toBe(false);
    const receipt = lines.find((l) => l.includes(",Receipt,") && l.includes(",CLIENT,"));
    expect(receipt).toMatch(/^2026-10-20,.*,1200,.*,0\.00,118000\.00,CLIENT,/);
    expect(lines.at(-1)).toMatch(/^Totals,,,,,,,,(\d+\.\d\d),\1$/);
  });

  it("needs finance.view", async () => {
    const s = await october();
    await expect(profitAndLoss(await makeActor("sales"), s.entity.id, oct)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("period close", () => {
  async function periods(entityId: string) {
    await db.$transaction((tx) => ensurePeriod(tx, entityId, day("2026-10-01")));
    const all = await db.accountingPeriod.findMany({
      where: { legalEntityId: entityId },
      orderBy: { startDate: "asc" },
    });
    return (name: string) => all.find((p) => p.name === name)!;
  }

  it("closes months in order from a checklist, refuses postings into them, and reopens latest first", async () => {
    const books = await makeBooks();
    const finance = await makeActor("finance");
    const bank = await makeBankAccount(books.entity.id);
    const period = await periods(books.entity.id);
    await move(books, "2026-10-02", bank.ledgerAccountId, "3000", 10_000);
    const draft = await createJournal(finance, books.entity.id, {
      date: "2026-10-15",
      narration: "Accrual",
      lines: [],
    });

    // October can't close before the months before it.
    await expect(closePeriod(finance, period("Oct 2026").id, { note: "x" })).rejects.toThrow(
      ConflictError,
    );
    for (const m of ["Apr", "May", "Jun", "Jul", "Aug", "Sep"]) {
      await closePeriod(finance, period(`${m} 2026`).id, {});
    }

    let close = await getPeriodClose(finance, period("Oct 2026").id);
    const state = Object.fromEntries(close.checks!.map((c) => [c.key, c.state]));
    expect(state).toMatchObject({
      earlier_periods: "ok",
      draft_journals: "blocking",
      trial_balance: "ok",
      bank_reconciled: "warning",
      suspense: "ok",
    });
    expect(close.canClose).toBe(false);
    await expect(closePeriod(finance, period("Oct 2026").id, { note: "x" })).rejects.toThrow(
      /draft journal/,
    );

    await discardJournal(finance, draft.id);
    close = await getPeriodClose(finance, period("Oct 2026").id);
    expect(close.canClose).toBe(true);
    await expect(closePeriod(finance, period("Oct 2026").id, {})).rejects.toMatchObject({
      fieldErrors: { note: [expect.any(String)] },
    });
    await expect(
      closePeriod(await makeActor("sales"), period("Oct 2026").id, { note: "x" }),
    ).rejects.toThrow(ForbiddenError);
    await closePeriod(finance, period("Oct 2026").id, {
      note: "Bank statement for October arrives on 5 November",
    });

    const closed = await getPeriodClose(finance, period("Oct 2026").id);
    expect(closed.period).toMatchObject({ status: "CLOSED", closedById: finance.id });
    expect(closed.events[0]).toMatchObject({ action: "CLOSED", note: expect.any(String) });
    expect(closed.events[0]!.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "bank_reconciled", state: "warning" }),
      ]),
    );
    await expect(move(books, "2026-10-30", bank.ledgerAccountId, "3000", 1)).rejects.toThrow(
      /closed/,
    );

    // Reopen latest first, with a reason.
    await expect(reopenPeriod(finance, period("Sep 2026").id, { reason: "x" })).rejects.toThrow(
      ConflictError,
    );
    await expect(reopenPeriod(finance, period("Oct 2026").id, { reason: "" })).rejects.toThrow(
      ValidationError,
    );
    await reopenPeriod(finance, period("Oct 2026").id, { reason: "Missed bank interest" });
    await move(books, "2026-10-30", bank.ledgerAccountId, "4920", 12);
    const reopened = await getPeriodClose(finance, period("Oct 2026").id);
    expect(reopened.events.map((e) => e.action)).toEqual(["REOPENED", "CLOSED"]);
    expect(
      await db.auditEvent.count({
        where: {
          targetId: period("Oct 2026").id,
          action: { in: ["accounting_period.closed", "accounting_period.reopened"] },
        },
      }),
    ).toBe(2);
  });

  it("is guarded in the database", async () => {
    const books = await makeBooks();
    const finance = await makeActor("finance");
    const period = await periods(books.entity.id);
    await closePeriod(finance, period("Apr 2026").id, {});
    const event = await db.periodCloseEvent.findFirstOrThrow({
      where: { periodId: period("Apr 2026").id },
    });

    await expect(
      db.accountingPeriod.update({
        where: { id: period("Jun 2026").id },
        data: { status: "CLOSED", closedAt: new Date(), closedById: finance.id },
      }),
    ).rejects.toThrow(/close the periods before/);
    await expect(
      db.accountingPeriod.update({
        where: { id: period("May 2026").id },
        data: { status: "CLOSED" },
      }),
    ).rejects.toThrow(/records who closed it/);
    await expect(
      db.accountingPeriod.update({
        where: { id: period("Apr 2026").id },
        data: { endDate: day("2026-04-29") },
      }),
    ).rejects.toThrow(/can't be moved/);
    await expect(
      db.accountingPeriod.delete({ where: { id: period("Mar 2027").id } }),
    ).rejects.toThrow(/can't be deleted/);
    await expect(
      db.periodCloseEvent.update({ where: { id: event.id }, data: { note: "Edited" } }),
    ).rejects.toThrow(/can't be changed/);
    await closePeriod(finance, period("May 2026").id, {});
    await expect(
      db.accountingPeriod.update({
        where: { id: period("Apr 2026").id },
        data: { status: "OPEN", closedAt: null, closedById: null },
      }),
    ).rejects.toThrow(/reopen the periods after/);
  });
});

describe("finance dashboard", () => {
  it("shows money owed both ways, cash, waiting work and close status", async () => {
    const s = await october();
    const d = await financeDashboard(s.finance, s.entity.id, day("2026-10-31"));
    expect(d.receivables).toMatchObject({ totalMinor: 0n, overdueMinor: 0n });
    expect(d.payables).toMatchObject({ totalMinor: 59_000_00n, overdueMinor: 0n });
    expect(d.banks).toEqual([
      expect.objectContaining({ balanceMinor: 318_500_00n, reconciledTo: null, unmatched: 0 }),
    ]);
    expect(d.unposted).toEqual({
      draftJournals: 0,
      draftInvoices: 0,
      draftCredits: 0,
      draftBills: 0,
    });
    expect(d.approvals).toEqual({ bills: 0, claims: 0, claimsMinor: 0n });
    expect(d.close.lastClosed).toBeNull();
    expect(d.close.openPast.map((p) => p.name)).toContain("Sep 2026");
    expect(d.exceptions).toEqual([]);

    await move(s, "2026-10-28", "2900", s.bank.ledgerAccountId, 100);
    const after = await financeDashboard(s.finance, s.entity.id, day("2026-10-31"));
    expect(after.exceptions.map((e) => e.key)).toEqual(["suspense"]);
    await expect(
      financeDashboard(await makeActor("sales"), s.entity.id, day("2026-10-31")),
    ).rejects.toThrow(ForbiddenError);
  });
});
