import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { listAuditEvents } from "@/server/audit/query";
import { listClients } from "@/server/crm/clients";
import { approveBill, listBills, submitBill } from "@/server/finance/bills";
import { listInvoices } from "@/server/finance/invoices";
import { dayBook, trialBalance } from "@/server/finance/ledger-reports";
import { payablesAgeing } from "@/server/finance/payables";
import { recordPayment } from "@/server/finance/payments";
import { receivablesAgeing } from "@/server/finance/receivables";
import { recordReceipt } from "@/server/finance/receipts";
import { profitAndLoss } from "@/server/finance/statements";
import { normalizeClientName } from "@/server/crm/normalize";
import { listProjects } from "@/server/projects/projects";
import { readinessContext } from "@/server/readiness/context";
import { runChecks } from "@/server/readiness/runs";
import { executiveDashboard } from "@/server/reports/executive";
import { makeActor } from "../helpers/actors";
import {
  day,
  draftBill,
  issueSimpleInvoice,
  makeBankAccount,
  makeBillableClient,
  makeBooks,
  makeVendor,
} from "../helpers/finance";

/*
 * Measures the paths people wait on most (spec §26, docs/performance.md)
 * against a few years of HMBL's volume, kept through the real services so
 * every invoice, bill, receipt and payment has its journal and audit events.
 * PERF_SCALE multiplies the volume; PERF_OUT writes the results as JSON.
 * Run with `pnpm test:perf`; it is not part of `pnpm test`.
 */

const SCALE = Number(process.env.PERF_SCALE ?? "1");
const VOLUME = {
  clients: Math.round(3000 * SCALE),
  projects: Math.round(1500 * SCALE),
  invoices: Math.round(1200 * SCALE),
  bills: Math.round(600 * SCALE),
};
/** A read slower than this, at the default volume, fails the run. */
const BUDGET_MS = 1500;
const RUNS = 5;

/** Runs `work` over `items`, `width` at a time. */
async function inBatches<T>(
  items: T[],
  width: number,
  work: (item: T, i: number) => Promise<void>,
) {
  for (let i = 0; i < items.length; i += width) {
    await Promise.all(items.slice(i, i + width).map((item, j) => work(item, i + j)));
  }
}

/** A date in the year to 2026-09-30, spread evenly by position. */
const dateAt = (i: number, n: number) =>
  new Date(Date.UTC(2025, 9, 1) + Math.floor((i / n) * 364) * 86_400_000)
    .toISOString()
    .slice(0, 10);

type Timing = { name: string; rows: number; medianMs: number; slowestMs: number };

async function time(name: string, read: () => Promise<unknown>): Promise<Timing> {
  await read(); // warm the connection and query plans, as a server that has been up would be
  const runs: number[] = [];
  let rows = 0;
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    const result = await read();
    runs.push(performance.now() - started);
    rows = Array.isArray(result) ? result.length : 1;
  }
  runs.sort((a, b) => a - b);
  return {
    name,
    rows,
    medianMs: Math.round(runs[Math.floor(RUNS / 2)]!),
    slowestMs: Math.round(runs[RUNS - 1]!),
  };
}

describe("performance at volume", () => {
  it("keeps the busiest reads within budget", { timeout: 1_800_000 }, async () => {
    const seedStarted = performance.now();
    const { entity } = await makeBooks();
    const owner = await makeActor("owner");
    const finance = await makeActor("finance");
    const bank = await makeBankAccount(entity.id);

    await db.client.createMany({
      data: Array.from({ length: VOLUME.clients }, (_, i) => {
        const name = `Client ${String(i).padStart(5, "0")} Events`;
        return {
          name,
          legalName: `${name} Pvt Ltd`,
          normalizedName: normalizeClientName(name),
          countryCode: "IN",
          currency: "INR",
        };
      }),
    });
    const billed = await Promise.all(Array.from({ length: 40 }, () => makeBillableClient()));
    await db.project.createMany({
      data: Array.from({ length: VOLUME.projects }, (_, i) => ({
        legalEntityId: entity.id,
        number: `PRJ-${String(i).padStart(5, "0")}`,
        name: `Project ${i}`,
        clientId: billed[i % billed.length]!.id,
        currency: "INR",
        createdById: owner.id,
      })),
    });

    const invoices: { id: string; clientId: string }[] = [];
    await inBatches(Array.from({ length: VOLUME.invoices }), 6, async (_, i) => {
      const client = billed[i % billed.length]!;
      const date = dateAt(i, VOLUME.invoices);
      const invoice = await issueSimpleInvoice(finance, entity.id, client.id, {
        amount: String(20_000 + (i % 50) * 1_000),
        invoiceDate: date,
        dueDate: date,
      });
      invoices.push({ id: invoice.id, clientId: client.id });
    });
    // Two in three invoices are paid in full.
    await inBatches(
      invoices.filter((_, i) => i % 3 !== 0),
      6,
      async (invoice, i) => {
        const full = await db.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
        const amount = (Number(full.totalMinor) / 100).toFixed(2);
        await recordReceipt(finance, entity.id, {
          clientId: invoice.clientId,
          depositAccountId: bank.ledgerAccountId,
          date: "2026-09-30",
          method: "BANK_TRANSFER",
          reference: `UTR-R${i}`,
          currency: "INR",
          amount,
          allocations: [{ invoiceId: invoice.id, amount }],
        });
      },
    );

    const vendors = await Promise.all(Array.from({ length: 20 }, () => makeVendor()));
    const bills: { id: string; vendorId: string }[] = [];
    await inBatches(Array.from({ length: VOLUME.bills }), 6, async (_, i) => {
      const vendor = vendors[i % vendors.length]!;
      const date = dateAt(i, VOLUME.bills);
      const bill = await draftBill(finance, entity.id, vendor.id, {
        billDate: date,
        dueDate: date,
      });
      await submitBill(finance, bill.id);
      await approveBill(owner, bill.id);
      bills.push({ id: bill.id, vendorId: vendor.id });
    });
    // Half the bills are paid, less TDS where there is any.
    await inBatches(
      bills.filter((_, i) => i % 2 === 0),
      6,
      async (bill, i) => {
        const open = await db.vendorBill.findUniqueOrThrow({ where: { id: bill.id } });
        const amount = (Number(open.payableMinor) / 100).toFixed(2);
        await recordPayment(finance, entity.id, {
          vendorId: bill.vendorId,
          paidFromId: bank.ledgerAccountId,
          date: "2026-09-30",
          method: "BANK_TRANSFER",
          reference: `UTR-P${i}`,
          currency: "INR",
          amount,
          allocations: [{ billId: bill.id, amount }],
        });
      },
    );
    const seedSeconds = Math.round((performance.now() - seedStarted) / 1000);

    const counts = {
      clients: await db.client.count(),
      projects: await db.project.count(),
      invoices: await db.salesInvoice.count(),
      receipts: await db.receipt.count(),
      bills: await db.vendorBill.count(),
      payments: await db.vendorPayment.count(),
      journals: await db.journal.count(),
      journalLines: await db.journalLine.count(),
      auditEvents: await db.auditEvent.count(),
    };

    const year = { from: day("2025-10-01"), to: day("2026-09-30") };
    const asAt = day("2026-10-31");
    const timings: Timing[] = [];
    const measure = async (name: string, read: () => Promise<unknown>) => {
      timings.push(await time(name, read));
    };
    await measure("Clients list", () => listClients(owner));
    await measure("Clients search", () => listClients(owner, { search: "0042" }));
    await measure("Projects list", () => listProjects(owner));
    await measure("Projects search", () => listProjects(owner, { search: "Billing" }));
    await measure("Invoices list", () => listInvoices(owner));
    await measure("Bills list", () => listBills(owner));
    await measure("Receivables ageing", () => receivablesAgeing(owner, entity.id, asAt));
    await measure("Payables ageing", () => payablesAgeing(owner, entity.id, asAt));
    await measure("Trial balance", () => trialBalance(owner, entity.id, asAt));
    await measure("Profit and loss, one year", () => profitAndLoss(owner, entity.id, year));
    await measure("Day book, one month", () =>
      dayBook(owner, entity.id, { from: day("2026-09-01"), to: day("2026-09-30") }),
    );
    await measure("Executive dashboard", () =>
      executiveDashboard(owner, entity.id, new Date("2026-10-15T06:00:00Z")),
    );
    await measure("Audit log, first page", () => listAuditEvents(owner));
    await measure("Readiness checks, finance and audit", () =>
      runChecks(readinessContext({ now: new Date("2026-10-31T00:00:00Z") }), ["finance", "audit"]),
    );

    const report = { scale: SCALE, seedSeconds, counts, budgetMs: BUDGET_MS, runs: RUNS, timings };
    console.log(JSON.stringify(report, null, 2));
    if (process.env.PERF_OUT)
      await writeFile(process.env.PERF_OUT, JSON.stringify(report, null, 2));

    expect(counts.invoices).toBe(VOLUME.invoices);
    const slow = timings.filter((t) => t.medianMs > BUDGET_MS * Math.max(1, SCALE));
    expect(slow).toEqual([]);
  });
});
