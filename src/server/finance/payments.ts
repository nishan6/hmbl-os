import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, PaymentStatus } from "@/generated/prisma/enums";
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
import { billSettlements, lockBill } from "./bills";
import { postJournal, reverseJournal, systemAccount, type PostingLine } from "./ledger";
import { financeNumber } from "./numbering";
import { exchangeLine, PAYMENT_METHODS } from "./receipts";

/*
 * Payments to vendors (docs/payables.md).
 *
 *   POSTED ──void──▶ VOIDED   (its journals reversed, its allocations released)
 *
 * The mirror of a receipt. A payment is posted when it is recorded: trade
 * payables are debited and the bank or cash account credited. It settles the
 * vendor's approved bills then or later; what isn't allocated is an advance
 * to the vendor, a debit on their payables. TDS was withheld when the bill
 * was approved, so a payment carries none. Recording needs `finance.post`,
 * voiding `finance.void`.
 */

type Tx = Prisma.TransactionClient;

export const PAYMENT_STATUSES: Record<PaymentStatus, string> = {
  POSTED: "Posted",
  VOIDED: "Voided",
};

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const allocationInput = z.object({
  billId: z.uuid(),
  amount: z.string().nullish(),
});

const paymentInput = z.object({
  vendorId: z.uuid({ message: "Choose a vendor" }),
  paidFromId: z.uuid({ message: "Choose the account the money left" }),
  date: requiredDate,
  method: z.enum(Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]], {
    message: "Choose how it was paid",
  }),
  reference: optionalText(120),
  currency: z.string().trim().toUpperCase().length(3, "Use a three-letter currency code"),
  fxRate: z.string().trim().nullish(),
  amount: z.string().trim().min(1, "Enter the amount paid"),
  notes: optionalText(1000),
  allocations: z.array(allocationInput).max(200).default([]),
});
export type PaymentInput = z.input<typeof paymentInput>;

// ─── Reading ─────────────────────────────────────────────────────────────────

async function paymentBalance(
  client: Tx | typeof db,
  payment: { id: string; amountMinor: bigint; baseMinor: bigint },
) {
  const sum = await client.vendorPaymentAllocation.aggregate({
    where: { paymentId: payment.id, voidedAt: null },
    _sum: { amountMinor: true, paymentBaseMinor: true },
  });
  return {
    allocatedMinor: sum._sum.amountMinor ?? 0n,
    unallocatedMinor: payment.amountMinor - (sum._sum.amountMinor ?? 0n),
    unallocatedBaseMinor: payment.baseMinor - (sum._sum.paymentBaseMinor ?? 0n),
  };
}

export async function listPayments(
  actor: Actor,
  options: {
    legalEntityId?: string | null;
    vendorId?: string;
    status?: PaymentStatus;
    search?: string;
  } = {},
) {
  authorize(actor, "finance.view");
  const q = options.search?.trim();
  const payments = await db.vendorPayment.findMany({
    where: {
      ...entityFilter(actor, "finance.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.vendorId ? { vendorId: options.vendorId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { reference: { contains: q, mode: "insensitive" } },
              { vendor: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      vendor: { select: { id: true, name: true } },
      paidFrom: { select: { code: true, name: true } },
      allocations: { where: { voidedAt: null }, select: { amountMinor: true } },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return payments.map(({ allocations, ...p }) => {
    const allocated = allocations.reduce((s, a) => s + a.amountMinor, 0n);
    return { ...p, unallocatedMinor: p.status === "POSTED" ? p.amountMinor - allocated : 0n };
  });
}

async function loadPayment(actor: Actor, id: string) {
  const payment = await db.vendorPayment.findUnique({ where: { id } });
  if (!payment) throw new NotFoundError();
  await getLegalEntity(actor, payment.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: payment.legalEntityId });
  return payment;
}

export async function getPayment(actor: Actor, id: string) {
  await loadPayment(actor, id);
  const payment = await db.vendorPayment.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: { select: { id: true, code: true, baseCurrency: true, timezone: true } },
      vendor: { select: { id: true, name: true } },
      paidFrom: { select: { id: true, code: true, name: true } },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: {
          bill: {
            select: {
              id: true,
              number: true,
              vendorInvoiceNumber: true,
              billDate: true,
              payableMinor: true,
            },
          },
        },
      },
    },
  });
  const balance = await paymentBalance(db, payment);
  const scope = { legalEntityId: payment.legalEntityId };
  const posted = payment.status === "POSTED";
  return {
    ...payment,
    ...balance,
    actions: {
      allocate: posted && balance.unallocatedMinor > 0n && can(actor, "finance.post", scope),
      void: posted && can(actor, "finance.void", scope),
    },
  };
}

/** Approved bills with something still to pay, oldest due first: one vendor's, or all. */
export async function openBills(
  actor: Actor,
  legalEntityId: string,
  vendorId?: string,
  currency?: string,
) {
  authorize(actor, "finance.view", { legalEntityId });
  const bills = await db.vendorBill.findMany({
    where: {
      legalEntityId,
      status: "APPROVED",
      ...(vendorId ? { vendorId } : {}),
      ...(currency ? { currency } : {}),
    },
    select: {
      id: true,
      number: true,
      vendorId: true,
      vendorInvoiceNumber: true,
      billDate: true,
      dueDate: true,
      currency: true,
      payableMinor: true,
    },
    orderBy: [{ dueDate: "asc" }, { number: "asc" }],
  });
  const settled = await billSettlements(
    db,
    bills.map((b) => b.id),
  );
  return bills
    .map((b) => ({ ...b, outstandingMinor: b.payableMinor - settled.get(b.id)!.paidMinor }))
    .filter((b) => b.outstandingMinor > 0n);
}

/** Vendors and money accounts for the payment form. */
export async function paymentFormOptions(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.post", { legalEntityId });
  const [vendors, accounts] = await Promise.all([
    db.vendor.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
    moneyAccountOptions(actor, legalEntityId),
  ]);
  return { entity, vendors, accounts };
}

// ─── Allocating ──────────────────────────────────────────────────────────────

type PlannedAllocation = {
  billId: string;
  billNumber: string;
  date: Date;
  amountMinor: bigint;
  billBaseMinor: bigint;
  paymentBaseMinor: bigint;
};

/** Locks each bill in id order, checks the amounts fit, and works out both base amounts. */
async function planAllocations(
  tx: Tx,
  payment: {
    legalEntityId: string;
    vendorId: string;
    currency: string;
    fxRate: string | Prisma.Decimal | null;
  },
  available: { amountMinor: bigint; baseMinor: bigint },
  wanted: { billId: string; amount?: string | null }[],
  baseCurrency: string,
  on: Date,
): Promise<PlannedAllocation[]> {
  const rows = wanted.map((w, index) => ({ ...w, index })).filter((w) => w.amount?.trim());
  const ids = [...new Set(rows.map((r) => r.billId))];
  if (ids.length !== rows.length) throw new ValidationError("Allocate to each bill once.");
  for (const id of [...ids].sort()) await lockBill(tx, id);
  const bills = await tx.vendorBill.findMany({ where: { id: { in: ids } } });
  const settled = await billSettlements(tx, ids);

  let left = { ...available };
  const planned: PlannedAllocation[] = [];
  for (const row of rows) {
    const field = `allocations.${row.index}.amount`;
    const bill = bills.find((b) => b.id === row.billId);
    if (
      !bill ||
      bill.status !== "APPROVED" ||
      bill.legalEntityId !== payment.legalEntityId ||
      bill.vendorId !== payment.vendorId
    ) {
      throw invalid(field, "Choose an approved bill of this vendor");
    }
    if (bill.currency !== payment.currency) {
      throw invalid(
        field,
        `This bill is in ${bill.currency}; the payment is in ${payment.currency}`,
      );
    }
    const amountMinor = parseMoneyToMinor(row.amount!, payment.currency);
    if (amountMinor === null || amountMinor <= 0n)
      throw invalid(field, "Enter an amount above zero");
    const s = settled.get(bill.id)!;
    const owed = {
      amountMinor: bill.payableMinor - s.paidMinor,
      baseMinor: bill.basePayableMinor - s.paidBaseMinor,
    };
    if (amountMinor > owed.amountMinor) throw invalid(field, "More than is still owed on the bill");
    if (amountMinor > left.amountMinor) {
      throw invalid(field, "More than is left of the payment to allocate");
    }
    const billBaseMinor = portionBase(amountMinor, owed, bill.currency, baseCurrency, bill.fxRate);
    const paymentBaseMinor = portionBase(
      amountMinor,
      left,
      payment.currency,
      baseCurrency,
      payment.fxRate,
    );
    left = {
      amountMinor: left.amountMinor - amountMinor,
      baseMinor: left.baseMinor - paymentBaseMinor,
    };
    planned.push({
      billId: bill.id,
      billNumber: bill.number!,
      date: on < bill.billDate ? bill.billDate : on,
      amountMinor,
      billBaseMinor,
      paymentBaseMinor,
    });
  }
  return planned;
}

// ─── Recording ───────────────────────────────────────────────────────────────

/**
 * Records and posts a payment to a vendor, allocated to bills now or later.
 * A bill cleared at a different rate from the one it was booked at leaves an
 * exchange difference: paying fewer rupees is a gain.
 */
export async function recordPayment(actor: Actor, legalEntityId: string, raw: PaymentInput) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.post", { legalEntityId });
  const data = parseInput(paymentInput, raw);
  const base = entity.baseCurrency;
  const vendor = await db.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor) throw invalid("vendorId", "Choose a vendor");
  const accounts = await moneyAccountOptions(actor, legalEntityId);
  const from = accounts.find((a) => a.id === data.paidFromId);
  if (!from) throw invalid("paidFromId", "Choose an active bank or cash account of this entity");
  if (from.currency !== data.currency) {
    throw invalid("currency", `${from.name} holds ${from.currency}`);
  }
  let fxRate: string | null = null;
  if (data.currency !== base) {
    if (!data.fxRate || parseRate(data.fxRate) === null) {
      throw invalid("fxRate", `Enter the rate in ${base} per 1 ${data.currency}`);
    }
    fxRate = data.fxRate;
  }
  const amountMinor = parseMoneyToMinor(data.amount, data.currency);
  if (amountMinor === null || amountMinor <= 0n) throw invalid("amount", "Enter the amount paid");

  const id = randomUUID();
  return db.$transaction(async (tx) => {
    const baseMinor = toBaseMinor(amountMinor, data.currency, base, fxRate);
    const planned = await planAllocations(
      tx,
      { legalEntityId, vendorId: vendor.id, currency: data.currency, fxRate },
      { amountMinor, baseMinor },
      data.allocations,
      base,
      data.date!,
    );
    const { number } = await financeNumber(tx, actor, {
      documentType: "vendor_payment",
      legalEntityId,
      date: data.date!,
    });
    const payables = await systemAccount(tx, legalEntityId, "PAYABLES");
    const party = { partyType: "VENDOR" as const, partyId: vendor.id };
    const fx = data.currency === base ? {} : { txCurrency: data.currency, fxRate };
    const advanceBase = baseMinor - planned.reduce((s, p) => s + p.paymentBaseMinor, 0n);
    // Payables were credited at the bill's rate; a cheaper settlement is a gain.
    const gain = planned.reduce((s, p) => s + p.billBaseMinor - p.paymentBaseMinor, 0n);
    const lines: PostingLine[] = [
      ...planned.map((p) => ({
        accountId: payables.id,
        debitMinor: p.billBaseMinor,
        description: `Against ${p.billNumber}`,
        ...(fx.txCurrency ? { txCurrency: data.currency, txAmountMinor: p.amountMinor } : {}),
        ...party,
      })),
      ...(advanceBase
        ? [{ accountId: payables.id, debitMinor: advanceBase, description: "Advance", ...party }]
        : []),
      {
        accountId: from.id,
        creditMinor: baseMinor,
        txAmountMinor: fx.txCurrency ? amountMinor : null,
        ...fx,
      },
      ...(await exchangeLine(tx, legalEntityId, gain)),
    ];
    const journal = await postJournal(tx, actor, {
      legalEntityId,
      date: data.date!,
      source: "VENDOR_PAYMENT",
      sourceId: id,
      sourceRef: number,
      narration: `Payment ${number} to ${vendor.name}${data.reference ? ` (${data.reference})` : ""}`,
      idempotencyKey: `vendor_payment:${id}`,
      isDemo: entity.isDemo,
      lines,
    });
    const payment = await tx.vendorPayment.create({
      data: {
        id,
        legalEntityId,
        number,
        vendorId: vendor.id,
        paidFromId: from.id,
        date: data.date!,
        method: data.method,
        reference: data.reference,
        currency: data.currency,
        fxRate,
        amountMinor,
        baseMinor,
        notes: data.notes,
        journalId: journal.id,
        createdById: actor.id,
        isDemo: entity.isDemo,
        allocations: {
          create: planned.map((p) => ({
            billId: p.billId,
            date: p.date,
            amountMinor: p.amountMinor,
            billBaseMinor: p.billBaseMinor,
            paymentBaseMinor: p.paymentBaseMinor,
            createdById: actor.id,
          })),
        },
      },
    });
    await recordAudit(tx, actor, {
      action: "vendor_payment.recorded",
      targetType: "vendor_payment",
      targetId: id,
      legalEntityId,
      metadata: {
        number,
        journal: journal.number,
        vendorId: vendor.id,
        amountMinor: amountMinor.toString(),
        currency: data.currency,
        allocations: planned.map((p) => ({
          bill: p.billNumber,
          amountMinor: p.amountMinor.toString(),
        })),
      },
    });
    return payment;
  });
}

const allocateInput = z.object({
  date: optionalDate,
  allocations: z.array(allocationInput).min(1).max(200),
});

async function lockPayment(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM vendor_payments WHERE id = ${id}::uuid FOR UPDATE`;
  const payment = await tx.vendorPayment.findUnique({ where: { id } });
  if (!payment) throw new NotFoundError();
  if (payment.status !== "POSTED") throw new ConflictError("This payment is voided.");
  return payment;
}

/** Applies an advance to bills, posting any exchange difference per allocation. */
export async function allocatePayment(
  actor: Actor,
  id: string,
  raw: z.input<typeof allocateInput>,
) {
  const before = await loadPayment(actor, id);
  authorize(actor, "finance.post", { legalEntityId: before.legalEntityId });
  const data = parseInput(allocateInput, raw);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  return db.$transaction(async (tx) => {
    const payment = await lockPayment(tx, id);
    const entity = await tx.legalEntity.findUniqueOrThrow({ where: { id: payment.legalEntityId } });
    const balance = await paymentBalance(tx, payment);
    let on = data.date ?? today;
    if (on < payment.date) on = payment.date;
    const planned = await planAllocations(
      tx,
      payment,
      { amountMinor: balance.unallocatedMinor, baseMinor: balance.unallocatedBaseMinor },
      data.allocations,
      entity.baseCurrency,
      on,
    );
    if (!planned.length) throw new ValidationError("Enter an amount to allocate.");
    const payables = await systemAccount(tx, payment.legalEntityId, "PAYABLES");
    for (const p of planned) {
      const allocationId = randomUUID();
      // The advance sits at the payment's rate; the bill clears at its own.
      const gain = p.billBaseMinor - p.paymentBaseMinor;
      const party = { partyType: "VENDOR" as const, partyId: payment.vendorId };
      const journal = gain
        ? await postJournal(tx, actor, {
            legalEntityId: payment.legalEntityId,
            date: p.date,
            source: "VENDOR_PAYMENT",
            sourceId: payment.id,
            sourceRef: payment.number,
            narration: `Exchange difference on ${payment.number} against ${p.billNumber}`,
            idempotencyKey: `vendor_payment_allocation:${allocationId}`,
            isDemo: payment.isDemo,
            lines: [
              gain > 0n
                ? { accountId: payables.id, debitMinor: gain, ...party }
                : { accountId: payables.id, creditMinor: -gain, ...party },
              ...(await exchangeLine(tx, payment.legalEntityId, gain)),
            ],
          })
        : null;
      await tx.vendorPaymentAllocation.create({
        data: {
          id: allocationId,
          paymentId: payment.id,
          billId: p.billId,
          date: p.date,
          amountMinor: p.amountMinor,
          billBaseMinor: p.billBaseMinor,
          paymentBaseMinor: p.paymentBaseMinor,
          journalId: journal?.id ?? null,
          createdById: actor.id,
        },
      });
    }
    await recordAudit(tx, actor, {
      action: "vendor_payment.allocated",
      targetType: "vendor_payment",
      targetId: payment.id,
      legalEntityId: payment.legalEntityId,
      metadata: {
        allocations: planned.map((p) => ({
          bill: p.billNumber,
          amountMinor: p.amountMinor.toString(),
        })),
      },
    });
    return payment;
  });
}

const voidInput = z.object({ date: requiredDate, reason: requiredText(500) });

/**
 * Voids a payment recorded in error or returned by the bank: reverses its
 * journals and reopens the bills it paid.
 */
export async function voidPayment(actor: Actor, id: string, raw: z.input<typeof voidInput>) {
  const before = await loadPayment(actor, id);
  authorize(actor, "finance.void", { legalEntityId: before.legalEntityId });
  const data = parseInput(voidInput, raw);
  if (data.date! < before.date) throw invalid("date", "A payment can't be voided before its date");
  return db.$transaction(async (tx) => {
    const payment = await lockPayment(tx, id);
    const allocations = await tx.vendorPaymentAllocation.findMany({
      where: { paymentId: id, voidedAt: null },
    });
    for (const a of [...allocations].sort((x, y) => x.billId.localeCompare(y.billId))) {
      await lockBill(tx, a.billId);
    }
    const reason = `Void of payment ${payment.number}: ${data.reason}`;
    const reversal = await reverseJournal(tx, actor, payment.journalId, {
      date: data.date!,
      reason,
    });
    for (const a of allocations) {
      if (a.journalId) await reverseJournal(tx, actor, a.journalId, { date: data.date!, reason });
    }
    const now = new Date();
    await tx.vendorPaymentAllocation.updateMany({
      where: { paymentId: id, voidedAt: null },
      data: { voidedAt: now },
    });
    const after = await tx.vendorPayment.update({
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
      action: "vendor_payment.voided",
      targetType: "vendor_payment",
      targetId: id,
      legalEntityId: payment.legalEntityId,
      changes: { status: { from: "POSTED", to: "VOIDED" } },
      metadata: { number: payment.number, reason: data.reason, reversal: reversal.number },
    });
    return after;
  });
}
