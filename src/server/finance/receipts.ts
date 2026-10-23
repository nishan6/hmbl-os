import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, ReceiptStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { optionalDate, requiredDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseRate, toBaseMinor } from "@/lib/fx";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { portionBase } from "@/lib/settlement";
import { optionalText, requiredText } from "@/lib/validation";
import { moneyAccountOptions } from "./bank-accounts";
import { invoiceSettlements, lockInvoice } from "./invoices";
import { postJournal, reverseJournal, systemAccount, type PostingLine } from "./ledger";
import { financeNumber } from "./numbering";

/*
 * Receipts from clients (docs/receipts.md).
 *
 *   POSTED ──void──▶ VOIDED   (its journals reversed, its allocations released)
 *
 * A receipt is posted when it is recorded: the bank or cash account and any
 * TDS the client deducted are debited, receivables credited. The money is
 * allocated to the client's open invoices then or later; what isn't
 * allocated stays on account. Recording needs `finance.post`, voiding
 * `finance.void`.
 */

type Tx = Prisma.TransactionClient;

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "Bank transfer (NEFT, RTGS, IMPS)",
  UPI: "UPI",
  CHEQUE: "Cheque",
  CASH: "Cash",
  CARD: "Card",
  OTHER: "Other",
};

/** Common TDS sections for services; any section can be typed. */
export const TDS_SECTIONS = {
  "194C": "194C: contracts (events, production)",
  "194J": "194J: professional or technical services",
  "194I": "194I: rent of equipment",
  "194O": "194O: e-commerce operators",
} as const;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const allocationInput = z.object({
  invoiceId: z.uuid(),
  amount: z.string().nullish(),
});

const receiptInput = z.object({
  clientId: z.uuid({ message: "Choose a client" }),
  depositAccountId: z.uuid({ message: "Choose the account the money went into" }),
  date: requiredDate,
  method: z.enum(Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]], {
    message: "Choose how it was paid",
  }),
  reference: optionalText(120),
  currency: z.string().trim().toUpperCase().length(3, "Use a three-letter currency code"),
  fxRate: z.string().trim().nullish(),
  amount: z.string().trim().min(1, "Enter the amount received"),
  tds: z.string().trim().nullish(),
  tdsSection: optionalText(10),
  notes: optionalText(1000),
  allocations: z.array(allocationInput).max(200).default([]),
});
export type ReceiptInput = z.input<typeof receiptInput>;

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Live allocations of a receipt and what is left on account. */
async function receiptBalance(
  client: Tx | typeof db,
  receipt: { id: string; amountMinor: bigint; tdsMinor: bigint; grossBaseMinor: bigint },
) {
  const sum = await client.receiptAllocation.aggregate({
    where: { receiptId: receipt.id, voidedAt: null },
    _sum: { amountMinor: true, receiptBaseMinor: true },
  });
  return {
    allocatedMinor: sum._sum.amountMinor ?? 0n,
    unallocatedMinor: receipt.amountMinor + receipt.tdsMinor - (sum._sum.amountMinor ?? 0n),
    unallocatedBaseMinor: receipt.grossBaseMinor - (sum._sum.receiptBaseMinor ?? 0n),
  };
}

export async function listReceipts(
  actor: Actor,
  options: {
    legalEntityId?: string | null;
    clientId?: string;
    status?: ReceiptStatus;
    search?: string;
  } = {},
) {
  authorize(actor, "finance.view");
  const q = options.search?.trim();
  const receipts = await db.receipt.findMany({
    where: {
      ...entityFilter(actor, "finance.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { reference: { contains: q, mode: "insensitive" } },
              { client: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      client: { select: { id: true, name: true } },
      depositAccount: { select: { code: true, name: true } },
      allocations: { where: { voidedAt: null }, select: { amountMinor: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return receipts.map(({ allocations, ...r }) => {
    const allocated = allocations.reduce((s, a) => s + a.amountMinor, 0n);
    return {
      ...r,
      unallocatedMinor: r.status === "POSTED" ? r.amountMinor + r.tdsMinor - allocated : 0n,
    };
  });
}

async function loadReceipt(actor: Actor, id: string) {
  const receipt = await db.receipt.findUnique({ where: { id } });
  if (!receipt) throw new NotFoundError();
  await getLegalEntity(actor, receipt.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: receipt.legalEntityId });
  return receipt;
}

export async function getReceipt(actor: Actor, id: string) {
  await loadReceipt(actor, id);
  const receipt = await db.receipt.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: { select: { id: true, code: true, baseCurrency: true, timezone: true } },
      client: { select: { id: true, name: true } },
      depositAccount: { select: { id: true, code: true, name: true } },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: {
          invoice: { select: { id: true, number: true, invoiceDate: true, totalMinor: true } },
        },
      },
    },
  });
  const balance = await receiptBalance(db, receipt);
  const scope = { legalEntityId: receipt.legalEntityId };
  const posted = receipt.status === "POSTED";
  return {
    ...receipt,
    ...balance,
    actions: {
      allocate: posted && balance.unallocatedMinor > 0n && can(actor, "finance.post", scope),
      void: posted && can(actor, "finance.void", scope),
    },
  };
}

/** Issued invoices with something still owed, oldest due first: one client's, or all of them. */
export async function openInvoices(
  actor: Actor,
  legalEntityId: string,
  clientId?: string,
  currency?: string,
) {
  authorize(actor, "finance.view", { legalEntityId });
  const invoices = await db.salesInvoice.findMany({
    where: {
      legalEntityId,
      status: "ISSUED",
      ...(clientId ? { clientId } : {}),
      ...(currency ? { currency } : {}),
    },
    select: {
      id: true,
      number: true,
      clientId: true,
      invoiceDate: true,
      dueDate: true,
      currency: true,
      totalMinor: true,
    },
    orderBy: [{ dueDate: "asc" }, { number: "asc" }],
  });
  const settled = await invoiceSettlements(
    db,
    invoices.map((i) => i.id),
  );
  return invoices
    .map((i) => {
      const s = settled.get(i.id)!;
      return { ...i, outstandingMinor: i.totalMinor - s.creditedMinor - s.paidMinor };
    })
    .filter((i) => i.outstandingMinor > 0n);
}

/** Clients and money accounts for the receipt form. */
export async function receiptFormOptions(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.post", { legalEntityId });
  const [clients, accounts] = await Promise.all([
    db.client.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
    moneyAccountOptions(actor, legalEntityId),
  ]);
  return { entity, clients, accounts };
}

// ─── Allocating ──────────────────────────────────────────────────────────────

type PlannedAllocation = {
  invoiceId: string;
  invoiceNumber: string;
  date: Date;
  amountMinor: bigint;
  invoiceBaseMinor: bigint;
  receiptBaseMinor: bigint;
};

/**
 * Locks each invoice (in id order, so two receipts never deadlock), checks
 * the amounts fit what is owed, and works out both base amounts.
 */
async function planAllocations(
  tx: Tx,
  receipt: {
    legalEntityId: string;
    clientId: string;
    currency: string;
    fxRate: string | Prisma.Decimal | null;
    date: Date;
  },
  available: { amountMinor: bigint; baseMinor: bigint },
  wanted: { invoiceId: string; amount?: string | null }[],
  baseCurrency: string,
  on: Date,
): Promise<PlannedAllocation[]> {
  const rows = wanted.map((w, index) => ({ ...w, index })).filter((w) => w.amount?.trim());
  const ids = [...new Set(rows.map((r) => r.invoiceId))];
  if (ids.length !== rows.length) throw new ValidationError("Allocate to each invoice once.");
  for (const id of [...ids].sort()) await lockInvoice(tx, id);
  const invoices = await tx.salesInvoice.findMany({ where: { id: { in: ids } } });
  const settled = await invoiceSettlements(tx, ids);

  let left = { ...available };
  const planned: PlannedAllocation[] = [];
  for (const row of rows) {
    const field = `allocations.${row.index}.amount`;
    const invoice = invoices.find((i) => i.id === row.invoiceId);
    if (
      !invoice ||
      invoice.status !== "ISSUED" ||
      invoice.legalEntityId !== receipt.legalEntityId ||
      invoice.clientId !== receipt.clientId
    ) {
      throw invalid(field, "Choose an issued invoice of this client");
    }
    if (invoice.currency !== receipt.currency) {
      throw invalid(
        field,
        `This invoice is in ${invoice.currency}; the receipt is in ${receipt.currency}`,
      );
    }
    const amountMinor = parseMoneyToMinor(row.amount!, receipt.currency);
    if (amountMinor === null || amountMinor <= 0n)
      throw invalid(field, "Enter an amount above zero");
    const s = settled.get(invoice.id)!;
    const owed = {
      amountMinor: invoice.totalMinor - s.creditedMinor - s.paidMinor,
      baseMinor: invoice.baseTotalMinor - s.creditedBaseMinor - s.paidBaseMinor,
    };
    if (amountMinor > owed.amountMinor) throw invalid(field, "More than the invoice still owes");
    if (amountMinor > left.amountMinor) {
      throw invalid(field, "More than is left of the receipt to allocate");
    }
    const invoiceBaseMinor = portionBase(
      amountMinor,
      owed,
      invoice.currency,
      baseCurrency,
      invoice.fxRate,
    );
    const receiptBaseMinor = portionBase(
      amountMinor,
      left,
      receipt.currency,
      baseCurrency,
      receipt.fxRate,
    );
    left = {
      amountMinor: left.amountMinor - amountMinor,
      baseMinor: left.baseMinor - receiptBaseMinor,
    };
    // Settling can't predate the invoice.
    const date = on < invoice.invoiceDate ? invoice.invoiceDate : on;
    planned.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number!,
      date,
      amountMinor,
      invoiceBaseMinor,
      receiptBaseMinor,
    });
    // The same invoice can't come up twice, so its settlement needn't be updated.
  }
  return planned;
}

/** The exchange difference as a ledger line: a gain is credited, a loss debited. */
export async function exchangeLine(
  tx: Tx,
  legalEntityId: string,
  gainMinor: bigint,
): Promise<PostingLine[]> {
  if (gainMinor === 0n) return [];
  const account = await systemAccount(tx, legalEntityId, gainMinor > 0n ? "FX_GAIN" : "FX_LOSS");
  return [
    gainMinor > 0n
      ? { accountId: account.id, creditMinor: gainMinor, description: "Exchange difference" }
      : { accountId: account.id, debitMinor: -gainMinor, description: "Exchange difference" },
  ];
}

// ─── Recording ───────────────────────────────────────────────────────────────

/**
 * Records and posts a receipt, allocated to invoices now or later. TDS the
 * client deducted counts towards settling invoices like money received.
 */
export async function recordReceipt(actor: Actor, legalEntityId: string, raw: ReceiptInput) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.post", { legalEntityId });
  const data = parseInput(receiptInput, raw);
  const base = entity.baseCurrency;
  const client = await db.client.findUnique({ where: { id: data.clientId } });
  if (!client) throw invalid("clientId", "Choose a client");
  const accounts = await moneyAccountOptions(actor, legalEntityId);
  const deposit = accounts.find((a) => a.id === data.depositAccountId);
  if (!deposit)
    throw invalid("depositAccountId", "Choose an active bank or cash account of this entity");
  if (deposit.currency !== data.currency) {
    throw invalid("currency", `${deposit.name} holds ${deposit.currency}`);
  }
  let fxRate: string | null = null;
  if (data.currency !== base) {
    if (!data.fxRate || parseRate(data.fxRate) === null) {
      throw invalid("fxRate", `Enter the rate in ${base} per 1 ${data.currency}`);
    }
    fxRate = data.fxRate;
  }
  const amountMinor = parseMoneyToMinor(data.amount, data.currency);
  if (amountMinor === null || amountMinor < 0n)
    throw invalid("amount", "Enter the amount received");
  const tdsMinor = data.tds?.trim() ? parseMoneyToMinor(data.tds, data.currency) : 0n;
  if (tdsMinor === null || tdsMinor < 0n)
    throw invalid("tds", "Enter the TDS deducted, or leave it blank");
  if (tdsMinor > 0n && data.currency !== base) {
    throw invalid("tds", `TDS is only recorded on receipts in ${base}`);
  }
  if (amountMinor + tdsMinor === 0n) throw invalid("amount", "Enter the amount received");
  if (tdsMinor > 0n && !data.tdsSection)
    throw invalid("tdsSection", "Enter the TDS section, such as 194C");

  const id = randomUUID();
  return db.$transaction(async (tx) => {
    const bankBase = toBaseMinor(amountMinor, data.currency, base, fxRate);
    const tdsBase = tdsMinor; // TDS is only in the base currency.
    const grossBaseMinor = bankBase + tdsBase;
    const planned = await planAllocations(
      tx,
      { legalEntityId, clientId: client.id, currency: data.currency, fxRate, date: data.date! },
      { amountMinor: amountMinor + tdsMinor, baseMinor: grossBaseMinor },
      data.allocations,
      base,
      data.date!,
    );
    const { number } = await financeNumber(tx, actor, {
      documentType: "receipt",
      legalEntityId,
      date: data.date!,
    });
    const [receivables, tdsAccount] = await Promise.all([
      systemAccount(tx, legalEntityId, "RECEIVABLES"),
      systemAccount(tx, legalEntityId, "TDS_RECEIVABLE"),
    ]);
    const party = { partyType: "CLIENT" as const, partyId: client.id };
    const fx = data.currency === base ? {} : { txCurrency: data.currency, fxRate };
    const onAccountBase = grossBaseMinor - planned.reduce((s, p) => s + p.receiptBaseMinor, 0n);
    const gain = planned.reduce((s, p) => s + p.receiptBaseMinor - p.invoiceBaseMinor, 0n);
    const lines: PostingLine[] = [
      {
        accountId: deposit.id,
        debitMinor: bankBase,
        txAmountMinor: fx.txCurrency ? amountMinor : null,
        ...fx,
      },
      ...(tdsMinor
        ? [
            {
              accountId: tdsAccount.id,
              debitMinor: tdsBase,
              description: `TDS u/s ${data.tdsSection}`,
              ...party,
            },
          ]
        : []),
      ...planned.map((p) => ({
        accountId: receivables.id,
        creditMinor: p.invoiceBaseMinor,
        description: `Against ${p.invoiceNumber}`,
        // At the invoice's rate, so no single rate describes the line.
        ...(fx.txCurrency ? { txCurrency: data.currency, txAmountMinor: p.amountMinor } : {}),
        ...party,
      })),
      ...(onAccountBase
        ? [
            {
              accountId: receivables.id,
              creditMinor: onAccountBase,
              description: "On account",
              ...party,
            },
          ]
        : []),
      ...(await exchangeLine(tx, legalEntityId, gain)),
    ];
    const journal = await postJournal(tx, actor, {
      legalEntityId,
      date: data.date!,
      source: "RECEIPT",
      sourceId: id,
      sourceRef: number,
      narration: `Receipt ${number} from ${client.name}${data.reference ? ` (${data.reference})` : ""}`,
      idempotencyKey: `receipt:${id}`,
      isDemo: entity.isDemo,
      lines,
    });
    const receipt = await tx.receipt.create({
      data: {
        id,
        legalEntityId,
        number,
        clientId: client.id,
        depositAccountId: deposit.id,
        date: data.date!,
        method: data.method,
        reference: data.reference,
        currency: data.currency,
        fxRate,
        amountMinor,
        tdsMinor,
        tdsSection: tdsMinor ? data.tdsSection : null,
        notes: data.notes,
        grossBaseMinor,
        journalId: journal.id,
        createdById: actor.id,
        isDemo: entity.isDemo,
        allocations: {
          create: planned.map((p) => ({
            invoiceId: p.invoiceId,
            date: p.date,
            amountMinor: p.amountMinor,
            invoiceBaseMinor: p.invoiceBaseMinor,
            receiptBaseMinor: p.receiptBaseMinor,
            createdById: actor.id,
          })),
        },
      },
    });
    await recordAudit(tx, actor, {
      action: "receipt.recorded",
      targetType: "receipt",
      targetId: id,
      legalEntityId,
      metadata: {
        number,
        journal: journal.number,
        clientId: client.id,
        amountMinor: amountMinor.toString(),
        tdsMinor: tdsMinor.toString(),
        currency: data.currency,
        allocations: planned.map((p) => ({
          invoice: p.invoiceNumber,
          amountMinor: p.amountMinor.toString(),
        })),
      },
    });
    return receipt;
  });
}

const allocateInput = z.object({
  date: optionalDate,
  allocations: z.array(allocationInput).min(1).max(200),
});

async function lockReceipt(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM receipts WHERE id = ${id}::uuid FOR UPDATE`;
  const receipt = await tx.receipt.findUnique({ where: { id } });
  if (!receipt) throw new NotFoundError();
  if (receipt.status !== "POSTED") throw new ConflictError("This receipt is voided.");
  return receipt;
}

/**
 * Applies money held on account to invoices. When the receipt and invoice
 * rates differ, each allocation posts its exchange difference.
 */
export async function allocateReceipt(
  actor: Actor,
  id: string,
  raw: z.input<typeof allocateInput>,
) {
  const before = await loadReceipt(actor, id);
  authorize(actor, "finance.post", { legalEntityId: before.legalEntityId });
  const data = parseInput(allocateInput, raw);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return db.$transaction(async (tx) => {
    const receipt = await lockReceipt(tx, id);
    const entity = await tx.legalEntity.findUniqueOrThrow({ where: { id: receipt.legalEntityId } });
    const balance = await receiptBalance(tx, receipt);
    let on = data.date ?? today;
    if (on < receipt.date) on = receipt.date;
    const planned = await planAllocations(
      tx,
      receipt,
      { amountMinor: balance.unallocatedMinor, baseMinor: balance.unallocatedBaseMinor },
      data.allocations,
      entity.baseCurrency,
      on,
    );
    if (!planned.length) throw new ValidationError("Enter an amount to allocate.");
    const receivables = await systemAccount(tx, receipt.legalEntityId, "RECEIVABLES");
    for (const p of planned) {
      const allocationId = randomUUID();
      // Receivables were credited at the receipt's rate; the invoice clears at its own.
      const gain = p.receiptBaseMinor - p.invoiceBaseMinor;
      const party = { partyType: "CLIENT" as const, partyId: receipt.clientId };
      const journal = gain
        ? await postJournal(tx, actor, {
            legalEntityId: receipt.legalEntityId,
            date: p.date,
            source: "RECEIPT",
            sourceId: receipt.id,
            sourceRef: receipt.number,
            narration: `Exchange difference on ${receipt.number} against ${p.invoiceNumber}`,
            idempotencyKey: `receipt_allocation:${allocationId}`,
            isDemo: receipt.isDemo,
            lines: [
              gain > 0n
                ? { accountId: receivables.id, debitMinor: gain, ...party }
                : { accountId: receivables.id, creditMinor: -gain, ...party },
              ...(await exchangeLine(tx, receipt.legalEntityId, gain)),
            ],
          })
        : null;
      await tx.receiptAllocation.create({
        data: {
          id: allocationId,
          receiptId: receipt.id,
          invoiceId: p.invoiceId,
          date: p.date,
          amountMinor: p.amountMinor,
          invoiceBaseMinor: p.invoiceBaseMinor,
          receiptBaseMinor: p.receiptBaseMinor,
          journalId: journal?.id ?? null,
          createdById: actor.id,
        },
      });
    }
    await recordAudit(tx, actor, {
      action: "receipt.allocated",
      targetType: "receipt",
      targetId: receipt.id,
      legalEntityId: receipt.legalEntityId,
      metadata: {
        allocations: planned.map((p) => ({
          invoice: p.invoiceNumber,
          amountMinor: p.amountMinor.toString(),
        })),
      },
    });
    return receipt;
  });
}

const voidInput = z.object({ date: requiredDate, reason: requiredText(500) });

/**
 * Voids a receipt recorded in error (a bounced cheque, the wrong client):
 * reverses its journal and any exchange differences on its allocations, and
 * reopens the invoices it settled.
 */
export async function voidReceipt(actor: Actor, id: string, raw: z.input<typeof voidInput>) {
  const before = await loadReceipt(actor, id);
  authorize(actor, "finance.void", { legalEntityId: before.legalEntityId });
  const data = parseInput(voidInput, raw);
  if (data.date! < before.date) throw invalid("date", "A receipt can't be voided before its date");
  return db.$transaction(async (tx) => {
    const receipt = await lockReceipt(tx, id);
    const allocations = await tx.receiptAllocation.findMany({
      where: { receiptId: id, voidedAt: null },
    });
    for (const a of [...allocations].sort((x, y) => x.invoiceId.localeCompare(y.invoiceId))) {
      await lockInvoice(tx, a.invoiceId);
    }
    const reason = `Void of receipt ${receipt.number}: ${data.reason}`;
    const reversal = await reverseJournal(tx, actor, receipt.journalId, {
      date: data.date!,
      reason,
    });
    for (const a of allocations) {
      if (a.journalId) await reverseJournal(tx, actor, a.journalId, { date: data.date!, reason });
    }
    const now = new Date();
    await tx.receiptAllocation.updateMany({
      where: { receiptId: id, voidedAt: null },
      data: { voidedAt: now },
    });
    const after = await tx.receipt.update({
      where: { id },
      data: {
        status: "VOIDED",
        voidDate: data.date!,
        voidedAt: now,
        voidedById: actor.id,
        voidReason: data.reason,
      },
    });
    await recordAudit(tx, actor, {
      action: "receipt.voided",
      targetType: "receipt",
      targetId: id,
      legalEntityId: receipt.legalEntityId,
      changes: { status: { from: "POSTED", to: "VOIDED" } },
      metadata: { number: receipt.number, reason: data.reason, reversal: reversal.number },
    });
    return after;
  });
}
