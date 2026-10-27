import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/permissions/authorize";
import { receivablesAgeing } from "@/server/finance/receivables";
import { payablesAgeing } from "@/server/finance/payables";
import { staffBalances } from "@/server/finance/expense-settlements";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatMoney } from "@/lib/format";
import { firstFew, plural, type CheckResult } from "@/lib/readiness";
import type { ReadinessContext } from "./context";

/*
 * Financial invariants (spec §32 C). The database already refuses an
 * unbalanced posted journal and changes to posted ones; these checks prove it
 * held, and look across records for what a single constraint can't see.
 */

/**
 * Reads the books for every entity. It holds only view permissions, exists
 * only inside a readiness run and is never reachable over HTTP on its own.
 */
const READER: Actor = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Readiness check",
  email: "readiness@system",
  grants: [
    {
      roleKey: "readiness",
      legalEntityId: null,
      permissions: new Set(["organisation.view", "finance.view"]),
    },
  ],
};

export async function journalsBalance(): Promise<CheckResult> {
  const broken = await db.$queryRaw<{ ref: string }[]>`
    SELECT e.code || ' ' || COALESCE(j.number, j.id::text) AS ref
    FROM journals j
    JOIN legal_entities e ON e.id = j."legalEntityId"
    LEFT JOIN journal_lines l ON l."journalId" = j.id
    WHERE j.status = 'POSTED'
    GROUP BY j.id, e.code
    HAVING COALESCE(SUM(l."debitMinor"), 0) <> COALESCE(SUM(l."creditMinor"), 0)
        OR COALESCE(SUM(l."debitMinor"), 0) <> j."totalMinor"
        OR COUNT(l.id) < 2
    ORDER BY 1`;
  const totals = await db.$queryRaw<
    { code: string; currency: string; journals: bigint; debit: bigint; credit: bigint }[]
  >`
    SELECT e.code, e."baseCurrency" AS currency,
           COUNT(DISTINCT j.id) AS journals,
           COALESCE(SUM(l."debitMinor"), 0)::bigint AS debit,
           COALESCE(SUM(l."creditMinor"), 0)::bigint AS credit
    FROM legal_entities e
    JOIN journals j ON j."legalEntityId" = e.id AND j.status = 'POSTED'
    JOIN journal_lines l ON l."journalId" = j.id
    GROUP BY e.id
    ORDER BY e.code`;
  const unequal = totals.filter((t) => t.debit !== t.credit);
  const evidence = totals.map(
    (t) =>
      `${t.code}: ${plural(Number(t.journals), "posted journal")}, debits ${formatMoney(t.debit, t.currency)}, credits ${formatMoney(t.credit, t.currency)}`,
  );
  if (!totals.length) evidence.push("Nothing posted yet");
  const fail = broken.length > 0 || unequal.length > 0;
  return {
    key: "journals-balance",
    area: "finance",
    title: "Posted journals balance",
    state: fail ? "fail" : "pass",
    summary: fail
      ? `${plural(broken.length, "posted journal")} out of balance; ${plural(unequal.length, "entity's trial balance", "entities' trial balances")} out`
      : "Every posted journal has at least two lines, debits equal credits, and each entity's trial balance agrees",
    evidence: [...firstFew(broken.map((b) => `Out of balance: ${b.ref}`)), ...evidence],
  };
}

type PostedDocument = {
  label: string;
  table: string;
  number: string;
  /** SQL condition on `d` for documents that must have a posted journal. */
  where: string;
  /** Voided with `voidDate`; invoices and credit notes are corrected, never voided. */
  voidable: boolean;
};

// Table and column names are constants, never input.
const POSTED_DOCUMENTS: PostedDocument[] = [
  {
    label: "Tax invoices",
    table: "sales_invoices",
    number: "number",
    where: `d.kind = 'TAX' AND d.status = 'ISSUED'`,
    voidable: false,
  },
  {
    label: "Credit notes",
    table: "credit_notes",
    number: "number",
    where: `d.status = 'ISSUED'`,
    voidable: false,
  },
  { label: "Receipts", table: "receipts", number: "number", where: "TRUE", voidable: true },
  {
    label: "Vendor bills",
    table: "vendor_bills",
    number: "number",
    where: `d."approvedAt" IS NOT NULL`,
    voidable: true,
  },
  {
    label: "Vendor payments",
    table: "vendor_payments",
    number: "number",
    where: "TRUE",
    voidable: true,
  },
  {
    label: "Staff advances",
    table: "staff_advances",
    number: "number",
    where: "TRUE",
    voidable: true,
  },
  {
    label: "Expense claims",
    table: "expense_claims",
    number: "number",
    where: `d."approvedAt" IS NOT NULL AND d.status IN ('APPROVED', 'VOIDED')`,
    voidable: true,
  },
  {
    label: "Expense settlements",
    table: "expense_settlements",
    number: "id",
    where: "TRUE",
    voidable: true,
  },
];

/**
 * Every document that moves money has its posted journal, and every voided
 * one has had that journal reversed, so the ledger and the documents agree.
 */
export async function documentsPosted(): Promise<CheckResult> {
  const missing: string[] = [];
  const unreversed: string[] = [];
  const counts: string[] = [];
  for (const doc of POSTED_DOCUMENTS) {
    const rows = await db.$queryRawUnsafe<
      { ref: string; posted: boolean; voided: boolean; reversed: boolean }[]
    >(
      `SELECT COALESCE(d."${doc.number}"::text, d.id::text) AS ref,
              (j.status IS NOT DISTINCT FROM 'POSTED') AS posted,
              ${doc.voidable ? `(d."voidDate" IS NOT NULL)` : "FALSE"} AS voided,
              EXISTS (SELECT 1 FROM journals r
                      WHERE r."reversalOfId" = j.id AND r.status = 'POSTED') AS reversed
       FROM ${doc.table} d
       LEFT JOIN journals j ON j.id = d."journalId"
       WHERE ${doc.where}`,
    );
    counts.push(`${doc.label}: ${rows.length}`);
    for (const r of rows) {
      if (!r.posted) missing.push(`${doc.label}: ${r.ref}`);
      else if (r.voided && !r.reversed) unreversed.push(`${doc.label}: ${r.ref}`);
    }
  }
  const fail = missing.length + unreversed.length > 0;
  return {
    key: "documents-posted",
    area: "finance",
    title: "Documents and the ledger agree",
    state: fail ? "fail" : "pass",
    summary: fail
      ? `${plural(missing.length, "document")} without a posted journal, ${plural(unreversed.length, "voided document")} not reversed`
      : "Every issued, approved or recorded document has its posted journal, and every voided one is reversed",
    evidence: [
      ...firstFew(missing.map((m) => `No posted journal: ${m}`)),
      ...firstFew(unreversed.map((m) => `Voided but not reversed: ${m}`)),
      counts.join(" · "),
    ],
  };
}

/**
 * A retried posting can't post twice: document journals carry an idempotency
 * key and the database keeps one journal per key per entity.
 */
export async function duplicatePostings(): Promise<CheckResult> {
  const [index] = await db.$queryRaw<[{ found: boolean }]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'journals'
        AND indexdef LIKE 'CREATE UNIQUE INDEX%("legalEntityId", "idempotencyKey")%'
    ) AS found`;
  const unkeyed = await db.$queryRaw<{ ref: string }[]>`
    SELECT e.code || ' ' || COALESCE(j.number, j.id::text) AS ref
    FROM journals j JOIN legal_entities e ON e.id = j."legalEntityId"
    WHERE j.status = 'POSTED' AND j.source <> 'MANUAL' AND j."idempotencyKey" IS NULL
    ORDER BY 1`;
  const fail = !index.found || unkeyed.length > 0;
  return {
    key: "duplicate-postings",
    area: "finance",
    title: "No duplicate postings",
    state: fail ? "fail" : "pass",
    summary: fail
      ? "A retried document posting could post twice"
      : "Every document journal has an idempotency key, and the database keeps one journal per key per entity",
    evidence: [
      index.found
        ? "Unique index on (entity, idempotency key) is in place"
        : "Unique index on (entity, idempotency key) is missing",
      ...firstFew(unkeyed.map((u) => `Document journal without a key: ${u.ref}`)),
    ],
  };
}

/**
 * Receivables, payables, staff advances and reimbursements payable are
 * control accounts: each balance must equal the open items behind it.
 */
export async function controlAccounts(context: ReadinessContext): Promise<CheckResult> {
  const asAt = parseDateOnly(toDateOnly(context.now))!;
  const entities = await db.legalEntity.findMany({
    where: { ledgerAccounts: { some: {} } },
    select: { id: true, code: true, baseCurrency: true },
    orderBy: { code: "asc" },
  });
  const evidence: string[] = [];
  const differences: string[] = [];
  for (const e of entities) {
    const money = (m: bigint) => formatMoney(m, e.baseCurrency);
    const [ar, ap, staff] = await Promise.all([
      receivablesAgeing(READER, e.id, asAt),
      payablesAgeing(READER, e.id, asAt),
      staffBalances(READER, e.id, asAt),
    ]);
    const pairs: [string, bigint, bigint][] = [
      ["receivables", ar.totals.totalMinor, ar.ledgerMinor],
      ["payables", ap.totals.totalMinor, ap.ledgerMinor],
      ["staff advances", staff.totals.advanceMinor, staff.advancesLedgerMinor],
      ["reimbursements payable", staff.totals.owedMinor, staff.claimsLedgerMinor],
    ];
    for (const [name, items, ledger] of pairs) {
      if (items !== ledger)
        differences.push(
          `${e.code} ${name}: open items ${money(items)}, ledger ${money(ledger)}, difference ${money(items - ledger)}`,
        );
    }
    evidence.push(
      `${e.code}: receivables ${money(ar.ledgerMinor)}, payables ${money(ap.ledgerMinor)}, advances ${money(staff.advancesLedgerMinor)}, reimbursements ${money(staff.claimsLedgerMinor)}`,
    );
  }
  if (!entities.length) evidence.push("No entity has a chart of accounts yet");
  return {
    key: "control-accounts",
    area: "finance",
    title: "Control accounts agree with open items",
    state: differences.length ? "fail" : "pass",
    summary: differences.length
      ? `${plural(differences.length, "control account")} differ from the documents behind them`
      : `Receivables, payables, staff advances and reimbursements payable equal their open items on ${asAt.toISOString().slice(0, 10)}`,
    evidence: [...differences, ...evidence],
  };
}
