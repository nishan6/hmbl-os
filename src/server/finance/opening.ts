import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { OpeningItemKind } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { normalizeClientName } from "@/server/crm/normalize";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { requiredDate } from "@/server/projects/schemas";
import { parseStatementDate } from "@/lib/bank-statement";
import { parseCsv } from "@/lib/csv";
import { ConflictError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { parseRate, toBaseMinor } from "@/lib/fx";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { postJournal, systemAccount, type PostingLine } from "./ledger";

/*
 * Bringing an entity's books over from the old system (docs/migration.md).
 * At the cut-over date the old system's balances come in as one opening
 * journal: account balances from its trial balance, and receivables and
 * payables as the open invoices and bills behind them, so later receipts and
 * payments settle them like any other. Nothing posts until every total
 * agrees with the old system's own reports.
 */

type Tx = Prisma.TransactionClient;

export type OpeningSection = "ACCOUNTS" | "RECEIVABLES" | "PAYABLES";

/** The columns each file needs, in order, as the downloadable templates have them. */
export const OPENING_COLUMNS: Record<OpeningSection, string[]> = {
  ACCOUNTS: ["Account code", "Debit", "Credit", "Description"],
  RECEIVABLES: [
    "Client",
    "Invoice number",
    "Invoice date",
    "Due date",
    "Currency",
    "Amount due",
    "Exchange rate",
  ],
  PAYABLES: [
    "Vendor",
    "Bill number",
    "Bill date",
    "Due date",
    "Currency",
    "Amount due",
    "Exchange rate",
  ],
};

const invalid = (field: string, messages: string[]) =>
  new ValidationError("Check the highlighted fields.", { [field]: messages });

async function entityOf(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  return entity;
}

const loadOpening = (client: Tx | typeof db, legalEntityId: string) =>
  client.openingBalance.findUnique({ where: { legalEntityId } });

function requireDraft(
  opening: { status: string } | null,
): asserts opening is NonNullable<typeof opening> {
  if (!opening) throw new ConflictError("Set the cut-over date first.");
  if (opening.status !== "DRAFT") {
    throw new ConflictError(
      "The opening balances are posted and can't change. Correct a document, or roll the cut-over back from the backup.",
    );
  }
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function getOpening(actor: Actor, legalEntityId: string) {
  const entity = await entityOf(actor, legalEntityId);
  const opening = await db.openingBalance.findUnique({
    where: { legalEntityId },
    include: {
      accountLines: {
        orderBy: { line: "asc" },
        include: { account: { select: { code: true, name: true } } },
      },
      items: {
        orderBy: [{ kind: "asc" }, { line: "asc" }],
        include: {
          client: { select: { name: true } },
          vendor: { select: { name: true } },
          invoice: { select: { id: true, number: true } },
          bill: { select: { id: true, number: true } },
        },
      },
    },
  });
  const scope = { legalEntityId };
  const journal = opening?.journalId
    ? await db.journal.findUnique({
        where: { id: opening.journalId },
        select: { id: true, number: true },
      })
    : null;
  const check = opening ? await reconcile(db, entity.baseCurrency, opening) : null;
  const people = await db.user.findMany({
    where: {
      id: { in: [opening?.createdById, opening?.postedById].filter((x): x is string => !!x) },
    },
    select: { id: true, name: true },
  });
  return {
    entity,
    opening,
    journal,
    check,
    people: new Map(people.map((p) => [p.id, p.name])),
    actions: {
      edit: (!opening || opening.status === "DRAFT") && can(actor, "finance.edit", scope),
      post: opening?.status === "DRAFT" && can(actor, "finance.post", scope),
    },
  };
}

type Totals = {
  debitMinor: bigint;
  creditMinor: bigint;
  receivablesMinor: bigint;
  payablesMinor: bigint;
  invoices: number;
  bills: number;
};

/**
 * Compares what is entered with the old system's totals. Every check must
 * agree, the journal must balance, and nothing may already be posted on or
 * before the cut-over date, before the opening can be posted.
 */
async function reconcile(
  client: Tx | typeof db,
  baseCurrency: string,
  opening: {
    id: string;
    legalEntityId: string;
    cutOverDate: Date;
    sourceDebitMinor: bigint | null;
    sourceReceivablesMinor: bigint | null;
    sourcePayablesMinor: bigint | null;
    sourceInvoiceCount: number | null;
    sourceBillCount: number | null;
  },
) {
  const [lines, items, earlier] = await Promise.all([
    client.openingAccountLine.aggregate({
      where: { openingId: opening.id },
      _sum: { debitMinor: true, creditMinor: true },
    }),
    client.openingItem.groupBy({
      by: ["kind"],
      where: { openingId: opening.id },
      _sum: { baseAmountMinor: true },
      _count: true,
    }),
    client.journal.count({
      where: {
        legalEntityId: opening.legalEntityId,
        status: "POSTED",
        date: { lte: opening.cutOverDate },
      },
    }),
  ]);
  const of = (kind: OpeningItemKind) => items.find((i) => i.kind === kind);
  const totals: Totals = {
    debitMinor: lines._sum.debitMinor ?? 0n,
    creditMinor: lines._sum.creditMinor ?? 0n,
    receivablesMinor: of("RECEIVABLE")?._sum.baseAmountMinor ?? 0n,
    payablesMinor: of("PAYABLE")?._sum.baseAmountMinor ?? 0n,
    invoices: of("RECEIVABLE")?._count ?? 0,
    bills: of("PAYABLE")?._count ?? 0,
  };
  const journalDebit = totals.debitMinor + totals.receivablesMinor;
  const journalCredit = totals.creditMinor + totals.payablesMinor;
  const money = (m: bigint) => formatMoney(m, baseCurrency);
  const compare = (
    key: string,
    label: string,
    ours: bigint | number,
    source: bigint | number | null,
    show: (v: bigint | number) => string,
  ) => ({
    key,
    label,
    ours: show(ours),
    source: source === null ? null : show(source),
    status:
      source === null
        ? ("missing" as const)
        : ours === source
          ? ("match" as const)
          : ("mismatch" as const),
    difference:
      source === null || ours === source
        ? null
        : typeof ours === "bigint"
          ? money((ours as bigint) - (source as bigint))
          : String((ours as number) - (source as number)),
  });
  const asMoney = (v: bigint | number) => money(v as bigint);
  const asCount = (v: bigint | number) => String(v);
  const checks = [
    compare(
      "debits",
      "Trial balance total debits",
      journalDebit,
      opening.sourceDebitMinor,
      asMoney,
    ),
    compare(
      "receivables",
      "Trade receivables (open invoices)",
      totals.receivablesMinor,
      opening.sourceReceivablesMinor,
      asMoney,
    ),
    compare(
      "payables",
      "Trade payables (open bills)",
      totals.payablesMinor,
      opening.sourcePayablesMinor,
      asMoney,
    ),
    compare("invoices", "Open invoices", totals.invoices, opening.sourceInvoiceCount, asCount),
    compare("bills", "Open bills", totals.bills, opening.sourceBillCount, asCount),
  ];
  const problems: string[] = [];
  if (journalDebit !== journalCredit) {
    problems.push(
      `Debits and credits differ by ${money(journalDebit - journalCredit)}. The old trial balance must balance, including receivables and payables.`,
    );
  }
  if (journalDebit === 0n && journalCredit === 0n) problems.push("Nothing has been entered yet.");
  for (const c of checks) {
    if (c.status === "missing")
      problems.push(`Enter the old system's figure for ${c.label.toLowerCase()}.`);
    if (c.status === "mismatch")
      problems.push(`${c.label} differs from the old system by ${c.difference}.`);
  }
  if (earlier) {
    problems.push(
      `${earlier} journal${earlier === 1 ? " is" : "s are"} already posted on or before the cut-over date. The opening balances must be the first entry in the books.`,
    );
  }
  return {
    totals,
    journalDebit,
    journalCredit,
    checks,
    problems,
    ready: problems.length === 0,
  };
}

// ─── The draft ───────────────────────────────────────────────────────────────

const amount = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((v) => v || null);
const count = z
  .string()
  .trim()
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!/^\d{1,6}$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "Enter a whole number" });
      return z.NEVER;
    }
    return Number(v);
  });

const setupInput = z.object({
  cutOverDate: requiredDate,
  sourceSystem: requiredText(100),
  sourceDebit: amount,
  sourceReceivables: amount,
  sourcePayables: amount,
  sourceInvoiceCount: count,
  sourceBillCount: count,
  notes: optionalText(2000),
});
export type OpeningSetupInput = z.input<typeof setupInput>;

/** The cut-over date, the old system, and the totals from its own reports. */
export async function saveOpeningSetup(
  actor: Actor,
  legalEntityId: string,
  raw: OpeningSetupInput,
) {
  const entity = await entityOf(actor, legalEntityId);
  authorize(actor, "finance.edit", { legalEntityId });
  const data = parseInput(setupInput, raw);
  const errors: Record<string, string[]> = {};
  const money = (key: "sourceDebit" | "sourceReceivables" | "sourcePayables") => {
    const text = data[key];
    if (text === null) return null;
    const minor = parseMoneyToMinor(text, entity.baseCurrency);
    if (minor === null || minor < 0n) {
      errors[key] = [`Enter an amount in ${entity.baseCurrency}`];
      return null;
    }
    return minor;
  };
  const values = {
    cutOverDate: data.cutOverDate!,
    sourceSystem: data.sourceSystem,
    sourceDebitMinor: money("sourceDebit"),
    sourceReceivablesMinor: money("sourceReceivables"),
    sourcePayablesMinor: money("sourcePayables"),
    sourceInvoiceCount: data.sourceInvoiceCount,
    sourceBillCount: data.sourceBillCount,
    notes: data.notes,
  };
  if (Object.keys(errors).length)
    throw new ValidationError("Check the highlighted fields.", errors);
  return db.$transaction(async (tx) => {
    const before = await loadOpening(tx, legalEntityId);
    if (before) requireDraft(before);
    const after = before
      ? await tx.openingBalance.update({ where: { id: before.id }, data: values })
      : await tx.openingBalance.create({
          data: { legalEntityId, createdById: actor.id, ...values },
        });
    if (before && before.cutOverDate.getTime() !== after.cutOverDate.getTime()) {
      // Item dates were checked against the old cut-over; check them again.
      const late = await tx.openingItem.count({
        where: { openingId: after.id, documentDate: { gt: after.cutOverDate } },
      });
      if (late) {
        throw invalid("cutOverDate", [
          `${late} open invoice${late === 1 ? " or bill is" : "s or bills are"} dated after this day`,
        ]);
      }
    }
    await recordAudit(tx, actor, {
      action: before ? "opening_balance.updated" : "opening_balance.started",
      targetType: "opening_balance",
      targetId: after.id,
      legalEntityId,
      changes: Object.fromEntries(
        Object.entries(values)
          .filter(
            ([k, v]) => String(before?.[k as keyof typeof before] ?? null) !== String(v ?? null),
          )
          .map(([k, v]) => [
            k,
            { from: stringify(before?.[k as keyof typeof before]), to: stringify(v) },
          ]),
      ),
    });
    return after;
  });
}

const stringify = (v: unknown) =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : typeof v === "bigint"
        ? v.toString()
        : v;

// ─── Files ───────────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A file's rows by column name. The header must hold every column (in any order). */
function readFile(section: OpeningSection, text: string) {
  const [header, ...rows] = parseCsv(text);
  const wanted = OPENING_COLUMNS[section];
  if (!header) throw invalid("text", ["The file is empty"]);
  const index = wanted.map((name) => header.findIndex((h) => norm(h) === norm(name)));
  const missing = wanted.filter(
    (name, i) => index[i]! < 0 && name !== "Description" && name !== "Exchange rate",
  );
  if (missing.length) {
    throw invalid("text", [
      `The file needs these columns: ${missing.join(", ")}. Download the template to see them all.`,
    ]);
  }
  return rows
    .map((cells, i) => ({
      line: i + 2,
      cell: (name: string) => {
        const at = index[wanted.indexOf(name)]!;
        return at < 0 ? "" : (cells[at] ?? "").trim();
      },
      blank: cells.every((c) => !c.trim()),
    }))
    .filter((r) => !r.blank);
}

function parseDay(text: string) {
  const iso = parseStatementDate(text, "YYYY-MM-DD") ?? parseStatementDate(text, "DD/MM/YYYY");
  return iso ? new Date(`${iso}T00:00:00Z`) : null;
}

/**
 * Replaces one part of the draft with a file. All or nothing: a file with any
 * problem saves nothing, and every problem is listed with its line.
 */
export async function importOpeningFile(
  actor: Actor,
  legalEntityId: string,
  raw: { section: string; text: string },
) {
  const entity = await entityOf(actor, legalEntityId);
  authorize(actor, "finance.edit", { legalEntityId });
  const section = raw.section as OpeningSection;
  if (!(section in OPENING_COLUMNS)) throw invalid("section", ["Choose what the file holds"]);
  if (!raw.text?.trim()) throw invalid("text", ["Choose a CSV file"]);
  if (Buffer.byteLength(raw.text) > 2_000_000) throw invalid("text", ["The file is over 2 MB"]);
  const opening = await loadOpening(db, legalEntityId);
  requireDraft(opening);
  const rows = readFile(section, raw.text);
  if (!rows.length) throw invalid("text", ["The file has no rows below its header"]);
  if (rows.length > 10_000) throw invalid("text", ["Import at most 10,000 rows at a time"]);
  const problems: string[] = [];
  const problem = (line: number, message: string) => {
    if (problems.length < 50) problems.push(`Line ${line}: ${message}`);
  };

  if (section === "ACCOUNTS") {
    const accounts = await db.ledgerAccount.findMany({
      where: { legalEntityId, status: "ACTIVE" },
      select: { id: true, code: true, name: true, isControl: true, systemKey: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code.toLowerCase(), a]));
    const seen = new Map<string, number>();
    const lines: Prisma.OpeningAccountLineCreateManyInput[] = [];
    for (const r of rows) {
      const code = r.cell("Account code");
      const account = byCode.get(code.toLowerCase());
      const debit = r.cell("Debit") ? parseMoneyToMinor(r.cell("Debit"), entity.baseCurrency) : 0n;
      const credit = r.cell("Credit")
        ? parseMoneyToMinor(r.cell("Credit"), entity.baseCurrency)
        : 0n;
      if (!account) {
        problem(
          r.line,
          code
            ? `No active account with code ${code} in this entity's chart`
            : "Account code is blank",
        );
        continue;
      }
      if (account.isControl) {
        problem(
          r.line,
          account.systemKey === "RECEIVABLES" || account.systemKey === "PAYABLES"
            ? `${account.code} ${account.name} comes from the open ${account.systemKey === "RECEIVABLES" ? "invoices" : "bills"} file, not the trial balance; leave it out`
            : `${account.code} ${account.name} is a control account. Settle it in the old system before cut-over, or leave it out`,
        );
        continue;
      }
      if (seen.has(account.id)) {
        problem(r.line, `${account.code} is already on line ${seen.get(account.id)}`);
        continue;
      }
      if (debit === null || credit === null || debit < 0n || credit < 0n) {
        problem(
          r.line,
          `Enter debit and credit as amounts in ${entity.baseCurrency}, not negative`,
        );
        continue;
      }
      if (debit > 0n && credit > 0n) {
        problem(r.line, "Enter a debit or a credit, not both");
        continue;
      }
      seen.set(account.id, r.line);
      // A zero balance is left out: it changes nothing.
      if (debit === 0n && credit === 0n) continue;
      lines.push({
        openingId: opening.id,
        line: r.line,
        accountId: account.id,
        debitMinor: debit,
        creditMinor: credit,
        description: r.cell("Description").slice(0, 200) || null,
      });
    }
    if (problems.length) throw invalid("text", problems);
    await db.$transaction(async (tx) => {
      await tx.openingAccountLine.deleteMany({ where: { openingId: opening.id } });
      await tx.openingAccountLine.createMany({ data: lines });
      await recordFile(tx, actor, opening.id, legalEntityId, section, lines.length);
    });
    return { count: lines.length };
  }

  const kind: OpeningItemKind = section === "RECEIVABLES" ? "RECEIVABLE" : "PAYABLE";
  const words =
    kind === "RECEIVABLE"
      ? { party: "Client", number: "Invoice number", date: "Invoice date", thing: "invoice" }
      : { party: "Vendor", number: "Bill number", date: "Bill date", thing: "bill" };
  const parties =
    kind === "RECEIVABLE"
      ? (
          await db.client.findMany({
            where: { status: "ACTIVE" },
            select: {
              id: true,
              name: true,
              legalName: true,
              normalizedName: true,
              invoiceCode: true,
            },
          })
        ).map((c) => ({
          id: c.id,
          keys: [c.invoiceCode, c.name, c.legalName],
          normalized: c.normalizedName,
        }))
      : (
          await db.vendor.findMany({
            where: { status: "ACTIVE" },
            select: { id: true, name: true, legalName: true, normalizedName: true, gstin: true },
          })
        ).map((v) => ({
          id: v.id,
          keys: [v.gstin, v.name, v.legalName],
          normalized: v.normalizedName,
        }));
  const findParty = (text: string) => {
    const t = text.trim().toLowerCase();
    const exact = parties.filter((p) => p.keys.some((k) => k && k.toLowerCase() === t));
    if (exact.length) return exact;
    const n = normalizeClientName(text);
    return parties.filter((p) => p.normalized === n);
  };
  const taken =
    kind === "RECEIVABLE"
      ? new Set(
          (
            await db.salesInvoice.findMany({
              where: { legalEntityId, number: { not: null } },
              select: { number: true },
            })
          ).map((i) => i.number!.toLowerCase()),
        )
      : new Set<string>();
  const seen = new Map<string, number>();
  const items: Prisma.OpeningItemCreateManyInput[] = [];
  for (const r of rows) {
    const partyText = r.cell(words.party);
    const matches = partyText ? findParty(partyText) : [];
    const reference = r.cell(words.number).slice(0, 100);
    const documentDate = parseDay(r.cell(words.date));
    const dueDate = parseDay(r.cell("Due date"));
    const currency = (r.cell("Currency") || entity.baseCurrency).toUpperCase();
    const amountMinor = /^[A-Z]{3}$/.test(currency)
      ? parseMoneyToMinor(r.cell("Amount due"), currency)
      : null;
    const rateText = r.cell("Exchange rate");
    const lineProblems: string[] = [];
    if (!partyText) lineProblems.push(`${words.party} is blank`);
    else if (!matches.length) {
      lineProblems.push(
        `No active ${words.party.toLowerCase()} called “${partyText}”. Import ${words.party.toLowerCase()}s first under Administration → Imports`,
      );
    } else if (matches.length > 1) {
      lineProblems.push(
        `“${partyText}” matches ${matches.length} ${words.party.toLowerCase()}s; use ${kind === "RECEIVABLE" ? "the client's invoice code" : "the vendor's GSTIN"}`,
      );
    }
    if (!reference) lineProblems.push(`${words.number} is blank`);
    else {
      const key = reference.toLowerCase() + (kind === "PAYABLE" ? `|${matches[0]?.id}` : "");
      if (seen.has(key)) lineProblems.push(`The same ${words.thing} as line ${seen.get(key)}`);
      else seen.set(key, r.line);
      if (taken.has(reference.toLowerCase())) {
        lineProblems.push(`Invoice ${reference} already exists in HMBL OS`);
      }
    }
    if (!documentDate)
      lineProblems.push(`${words.date} must be a date such as 2026-03-31 or 31/03/2026`);
    else if (documentDate > opening.cutOverDate)
      lineProblems.push(`${words.date} is after the cut-over date`);
    if (!dueDate) lineProblems.push("Due date must be a date such as 2026-03-31 or 31/03/2026");
    else if (documentDate && dueDate < documentDate)
      lineProblems.push(`Due date is before the ${words.thing} date`);
    if (amountMinor === null || amountMinor <= 0n) {
      lineProblems.push(`Amount due must be more than zero, in ${currency}`);
    }
    let rate: string | null = null;
    if (currency !== entity.baseCurrency) {
      if (!rateText || parseRate(rateText) === null) {
        lineProblems.push(
          `Enter the exchange rate the old system used (${entity.baseCurrency} per ${currency})`,
        );
      } else rate = rateText;
    }
    if (lineProblems.length) {
      problem(r.line, lineProblems.join("; "));
      continue;
    }
    items.push({
      openingId: opening.id,
      kind,
      line: r.line,
      clientId: kind === "RECEIVABLE" ? matches[0]!.id : null,
      vendorId: kind === "PAYABLE" ? matches[0]!.id : null,
      reference,
      documentDate: documentDate!,
      dueDate: dueDate!,
      currency,
      amountMinor: amountMinor!,
      fxRate: rate,
      baseAmountMinor: toBaseMinor(amountMinor!, currency, entity.baseCurrency, rate),
    });
  }
  if (problems.length) throw invalid("text", problems);
  await db.$transaction(async (tx) => {
    await tx.openingItem.deleteMany({ where: { openingId: opening.id, kind } });
    await tx.openingItem.createMany({ data: items });
    await recordFile(tx, actor, opening.id, legalEntityId, section, items.length);
  });
  return { count: items.length };
}

function recordFile(
  tx: Tx,
  actor: Actor,
  openingId: string,
  legalEntityId: string,
  section: OpeningSection,
  rows: number,
) {
  return recordAudit(tx, actor, {
    action: "opening_balance.file_imported",
    targetType: "opening_balance",
    targetId: openingId,
    legalEntityId,
    metadata: { section, rows },
  });
}

// ─── Posting ─────────────────────────────────────────────────────────────────

/**
 * Posts the opening balances in one transaction, refused unless every
 * reconciliation check agrees. Each open invoice and bill is issued with its
 * own journal against opening balance equity, so later receipts, payments,
 * credit notes and voids treat it like any other; one more journal posts the
 * account balances and clears opening balance equity back to the old
 * system's figure. Posted books don't change: a wrong opening is corrected
 * document by document, or the whole cut-over rolled back from the backup.
 */
export async function postOpening(actor: Actor, legalEntityId: string) {
  const entity = await entityOf(actor, legalEntityId);
  authorize(actor, "finance.post", { legalEntityId });
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM opening_balances WHERE "legalEntityId" = ${legalEntityId}::uuid FOR UPDATE`;
      const opening = await loadOpening(tx, legalEntityId);
      requireDraft(opening);
      const check = await reconcile(tx, entity.baseCurrency, opening);
      if (!check.ready) throw new ConflictError(`Nothing was posted: ${check.problems.join(" ")}`);

      const [accountLines, items, receivables, payables, equity] = await Promise.all([
        tx.openingAccountLine.findMany({
          where: { openingId: opening.id },
          orderBy: { line: "asc" },
        }),
        tx.openingItem.findMany({
          where: { openingId: opening.id },
          orderBy: [{ kind: "asc" }, { line: "asc" }],
          include: { client: true, vendor: true },
        }),
        systemAccount(tx, legalEntityId, "RECEIVABLES"),
        systemAccount(tx, legalEntityId, "PAYABLES"),
        systemAccount(tx, legalEntityId, "OPENING_BALANCES"),
      ]);
      const note = `Opening balance from ${opening.sourceSystem}: still owed at the cut-over date.`;
      const post = (sourceId: string, sourceRef: string, narration: string, lines: PostingLine[]) =>
        postJournal(tx, actor, {
          legalEntityId,
          date: opening.cutOverDate,
          source: "OPENING_BALANCE",
          sourceId,
          sourceRef,
          narration,
          idempotencyKey: `opening:${sourceId}`,
          lines,
        });
      const fx = (item: (typeof items)[number]) =>
        item.currency === entity.baseCurrency
          ? {}
          : { txCurrency: item.currency, txAmountMinor: item.amountMinor, fxRate: item.fxRate };

      let bills = 0;
      for (const item of items) {
        if (item.kind === "RECEIVABLE") {
          const client = item.client!;
          // Lines go on while the invoice is a draft; then it is issued.
          const draft = await tx.salesInvoice.create({
            data: {
              legalEntityId,
              kind: "TAX",
              clientId: client.id,
              invoiceDate: item.documentDate,
              dueDate: item.dueDate,
              currency: item.currency,
              fxRate: item.fxRate,
              supplyType: "NON_GST",
              placeOfSupplyCountry: client.countryCode,
              clientName: client.legalName ?? client.name,
              notes: note,
              subtotalMinor: item.amountMinor,
              totalMinor: item.amountMinor,
              baseTotalMinor: item.baseAmountMinor,
              createdById: actor.id,
              openingItemId: item.id,
              lines: {
                create: {
                  position: 0,
                  description: `Balance of ${opening.sourceSystem} invoice ${item.reference}`,
                  quantity: 1,
                  unitPriceMinor: item.amountMinor,
                  amountMinor: item.amountMinor,
                  totalMinor: item.amountMinor,
                  revenueAccountId: equity.id,
                },
              },
            },
          });
          const journal = await post(
            draft.id,
            item.reference,
            `Opening balance: invoice ${item.reference} to ${client.name}`,
            [
              {
                accountId: receivables.id,
                debitMinor: item.baseAmountMinor,
                partyType: "CLIENT",
                partyId: client.id,
                ...fx(item),
              },
              { accountId: equity.id, creditMinor: item.baseAmountMinor },
            ],
          );
          await tx.salesInvoice.update({
            where: { id: draft.id },
            data: {
              status: "ISSUED",
              number: item.reference,
              journalId: journal.id,
              issuedAt: new Date(),
              issuedById: actor.id,
            },
          });
        } else {
          const vendor = item.vendor!;
          bills += 1;
          const id = randomUUID();
          const number = `OB-${String(bills).padStart(4, "0")}`;
          const journal = await post(
            id,
            number,
            `Opening balance: bill ${item.reference} from ${vendor.name}`,
            [
              { accountId: equity.id, debitMinor: item.baseAmountMinor },
              {
                accountId: payables.id,
                creditMinor: item.baseAmountMinor,
                partyType: "VENDOR",
                partyId: vendor.id,
                ...fx(item),
              },
            ],
          );
          await tx.vendorBill.create({
            data: {
              id,
              legalEntityId,
              number,
              status: "APPROVED",
              vendorId: vendor.id,
              vendorInvoiceNumber: item.reference,
              billDate: item.documentDate,
              dueDate: item.dueDate,
              currency: item.currency,
              fxRate: item.fxRate,
              supplyType: "NON_GST",
              vendorGstin: vendor.gstin,
              notes: note,
              subtotalMinor: item.amountMinor,
              totalMinor: item.amountMinor,
              payableMinor: item.amountMinor,
              basePayableMinor: item.baseAmountMinor,
              journalId: journal.id,
              approvedAt: new Date(),
              approvedById: actor.id,
              createdById: actor.id,
              openingItemId: item.id,
            },
          });
        }
      }

      // The account balances, with opening balance equity taking back what
      // the invoices and bills put there, so it ends where the old system had it.
      const net = check.totals.receivablesMinor - check.totals.payablesMinor;
      const journal = await post(
        opening.id,
        opening.sourceSystem,
        `Opening balances from ${opening.sourceSystem} at ${opening.cutOverDate.toISOString().slice(0, 10)}`,
        [
          ...accountLines.map((l) => ({
            accountId: l.accountId,
            debitMinor: l.debitMinor,
            creditMinor: l.creditMinor,
            description: l.description,
          })),
          {
            accountId: equity.id,
            debitMinor: net > 0n ? net : 0n,
            creditMinor: net < 0n ? -net : 0n,
            description: "Receivables and payables, posted with the open invoices and bills",
          },
        ],
      );
      const after = await tx.openingBalance.update({
        where: { id: opening.id },
        data: {
          status: "POSTED",
          journalId: journal.id,
          postedAt: new Date(),
          postedById: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: "opening_balance.posted",
        targetType: "opening_balance",
        targetId: opening.id,
        legalEntityId,
        changes: { status: { from: "DRAFT", to: "POSTED" } },
        metadata: {
          journal: journal.number,
          cutOverDate: opening.cutOverDate.toISOString().slice(0, 10),
          totalMinor: check.journalDebit.toString(),
          invoices: check.totals.invoices,
          bills: check.totals.bills,
        },
      });
      return after;
    },
    { timeout: 120_000 },
  );
}
