import "server-only";
import { z } from "zod";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { allocateNumber } from "@/server/numbering/service";
import { getLegalEntity } from "@/server/organisation/service";
import { requiredDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { documentTotals, priceCreditLine } from "@/lib/invoice";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { requiredText } from "@/lib/validation";
import { invoiceSettlements, lockInvoice, salesPostingLines } from "./invoices";
import { postJournal } from "./ledger";

/*
 * Credit notes reduce an issued invoice (docs/invoicing.md):
 *
 *   DRAFT ──issue──▶ ISSUED   (numbered, posted: reverses income, tax and receivable)
 *   DRAFT ──discard──▶ DISCARDED
 *
 * Each line credits part of one invoice line, at that line's tax rate and the
 * invoice's exchange rate. A credit note never takes an invoice below zero:
 * the total credited stays within what is still outstanding.
 */

const lineInput = z.object({
  invoiceLineId: z.uuid(),
  amount: z.string().nullish(),
});

const draftInput = z.object({
  date: requiredDate,
  reason: requiredText(1000),
  lines: z.array(lineInput).max(200),
});
export type CreditNoteDraftInput = z.input<typeof draftInput>;

async function loadCreditNote(actor: Actor, id: string) {
  const note = await db.creditNote.findUnique({ where: { id } });
  if (!note) throw new NotFoundError();
  await getLegalEntity(actor, note.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: note.legalEntityId });
  return note;
}

/** Taxable amounts already credited by issued credit notes, per invoice line. */
async function creditedByLine(client: Pick<typeof db, "creditNoteLine">, invoiceId: string) {
  const rows = await client.creditNoteLine.groupBy({
    by: ["invoiceLineId"],
    where: { creditNote: { invoiceId, status: "ISSUED" } },
    _sum: { amountMinor: true },
  });
  return new Map(rows.map((r) => [r.invoiceLineId, r._sum.amountMinor ?? 0n]));
}

export async function listCreditNotes(
  actor: Actor,
  options: { legalEntityId?: string | null; status?: InvoiceStatus; search?: string } = {},
) {
  authorize(actor, "finance.view");
  const q = options.search?.trim();
  return db.creditNote.findMany({
    where: {
      ...entityFilter(actor, "finance.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.status ? { status: options.status } : { status: { not: "DISCARDED" } }),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { reason: { contains: q, mode: "insensitive" } },
              { invoice: { number: { contains: q, mode: "insensitive" } } },
              { invoice: { clientName: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { invoice: { select: { id: true, number: true, clientName: true, currency: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
}

export async function getCreditNote(actor: Actor, id: string) {
  await loadCreditNote(actor, id);
  const note = await db.creditNote.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: {
        select: {
          id: true,
          code: true,
          legalName: true,
          tradingName: true,
          baseCurrency: true,
          timezone: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          region: true,
          postalCode: true,
          isDemo: true,
        },
      },
      invoice: {
        select: {
          id: true,
          number: true,
          invoiceDate: true,
          currency: true,
          clientName: true,
          clientGstin: true,
          clientAddress: true,
          entityGstin: true,
          clientId: true,
          projectId: true,
          supplyType: true,
          placeOfSupplyCode: true,
          placeOfSupplyCountry: true,
        },
      },
      lines: {
        orderBy: { position: "asc" },
        include: {
          invoiceLine: { select: { description: true, taxRateBps: true, sacCode: true } },
        },
      },
    },
  });
  const scope = { legalEntityId: note.legalEntityId };
  const draft = note.status === "DRAFT";
  return {
    ...note,
    actions: {
      issue: draft && can(actor, "finance.issue", scope),
      discard: draft && can(actor, "finance.edit", scope),
    },
  };
}

/** What can still be credited on each line of an issued invoice. */
export async function creditableLines(actor: Actor, invoiceId: string) {
  const invoice = await db.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!invoice) throw new NotFoundError();
  await getLegalEntity(actor, invoice.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: invoice.legalEntityId });
  const credited = await creditedByLine(db, invoiceId);
  return invoice.lines.map((l) => ({
    ...l,
    creditedMinor: credited.get(l.id) ?? 0n,
    remainingMinor: l.amountMinor - (credited.get(l.id) ?? 0n),
  }));
}

/** Drafts a credit note against an issued invoice. Lines left blank credit nothing. */
export async function createCreditNote(actor: Actor, invoiceId: string, raw: CreditNoteDraftInput) {
  const invoice = await db.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: { lines: true },
  });
  if (!invoice) throw new NotFoundError();
  await getLegalEntity(actor, invoice.legalEntityId);
  authorize(actor, "finance.create", { legalEntityId: invoice.legalEntityId });
  if (invoice.status !== "ISSUED" || invoice.kind !== "TAX") {
    throw new ConflictError("Only issued tax invoices can be credited.");
  }
  const data = parseInput(draftInput, raw);
  if (data.date! < invoice.invoiceDate) {
    throw new ValidationError("Check the highlighted fields.", {
      date: ["A credit note can't be dated before its invoice"],
    });
  }
  const credited = await creditedByLine(db, invoiceId);
  const lines = data.lines.flatMap((l, i) => {
    if (!l.amount?.trim()) return [];
    const line = invoice.lines.find((x) => x.id === l.invoiceLineId);
    if (!line) throw new ValidationError("Choose lines of this invoice.");
    const amountMinor = parseMoneyToMinor(l.amount, invoice.currency);
    const remaining = line.amountMinor - (credited.get(line.id) ?? 0n);
    if (amountMinor === null || amountMinor <= 0n) {
      throw new ValidationError("Check the highlighted fields.", {
        [`lines.${i}.amount`]: ["Enter an amount above zero"],
      });
    }
    if (amountMinor > remaining) {
      throw new ValidationError("Check the highlighted fields.", {
        [`lines.${i}.amount`]: ["More than is left to credit on this line"],
      });
    }
    return [
      {
        invoiceLineId: line.id,
        ...priceCreditLine(amountMinor, line.taxRateBps, invoice.supplyType),
      },
    ];
  });
  if (!lines.length) throw new ValidationError("Enter an amount to credit on at least one line.");
  const totals = documentTotals(lines);
  return db.$transaction(async (tx) => {
    const note = await tx.creditNote.create({
      data: {
        legalEntityId: invoice.legalEntityId,
        invoiceId,
        date: data.date!,
        reason: data.reason,
        createdById: actor.id,
        ...totals,
        lines: { create: lines.map((l, position) => ({ ...l, position })) },
      },
    });
    await recordAudit(tx, actor, {
      action: "credit_note.drafted",
      targetType: "sales_invoice",
      targetId: invoiceId,
      legalEntityId: invoice.legalEntityId,
      metadata: {
        creditNoteId: note.id,
        totalMinor: note.totalMinor.toString(),
        reason: data.reason,
      },
    });
    return note;
  });
}

async function lockNote(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], id: string) {
  await tx.$queryRaw`SELECT id FROM credit_notes WHERE id = ${id}::uuid FOR UPDATE`;
  const note = await tx.creditNote.findUnique({ where: { id }, include: { lines: true } });
  if (!note) throw new NotFoundError();
  if (note.status !== "DRAFT") {
    throw new ConflictError(
      `This credit note is ${note.status.toLowerCase()}, so it can't change.`,
    );
  }
  return note;
}

/**
 * Issues a draft credit note: numbers it and posts the mirror of its share of
 * the invoice. Checked again under lock, so two credit notes issued at once
 * can't together credit more than the invoice has outstanding.
 */
export async function issueCreditNote(actor: Actor, id: string) {
  const note = await loadCreditNote(actor, id);
  authorize(actor, "finance.issue", { legalEntityId: note.legalEntityId });
  return db.$transaction(async (tx) => {
    const invoice = await lockInvoice(tx, note.invoiceId);
    const current = await lockNote(tx, id);
    const [invoiceLines, credited, settled] = await Promise.all([
      tx.salesInvoiceLine.findMany({ where: { invoiceId: invoice.id } }),
      creditedByLine(tx, invoice.id),
      invoiceSettlements(tx, [invoice.id]),
    ]);
    for (const l of current.lines) {
      const line = invoiceLines.find((x) => x.id === l.invoiceLineId)!;
      if (l.amountMinor > line.amountMinor - (credited.get(line.id) ?? 0n)) {
        throw new ConflictError(
          `"${line.description}" has already been credited. Discard this draft and start again.`,
        );
      }
    }
    const s = settled.get(invoice.id)!;
    if (current.totalMinor > invoice.totalMinor - s.creditedMinor - s.paidMinor) {
      throw new ConflictError("This credit note is more than the invoice still has outstanding.");
    }
    const entity = await tx.legalEntity.findUniqueOrThrow({ where: { id: note.legalEntityId } });
    const { number } = await allocateNumber(tx, {
      documentType: "credit_note",
      legalEntityId: note.legalEntityId,
      date: current.date,
    });
    const { lines, baseTotalMinor } = await salesPostingLines(
      tx,
      {
        legalEntityId: invoice.legalEntityId,
        clientId: invoice.clientId,
        projectId: invoice.projectId,
        currency: invoice.currency,
        fxRate: invoice.fxRate,
        deferred: invoice.revenueDeferred && !invoice.revenueRecognisedAt,
        lines: current.lines.map((l) => {
          const line = invoiceLines.find((x) => x.id === l.invoiceLineId)!;
          return {
            revenueAccountId: line.revenueAccountId,
            amountMinor: l.amountMinor,
            description: line.description,
          };
        }),
        tax: current,
        totalMinor: current.totalMinor,
      },
      entity.baseCurrency,
      -1,
    );
    const journal = await postJournal(tx, actor, {
      legalEntityId: note.legalEntityId,
      date: current.date,
      source: "CREDIT_NOTE",
      sourceId: id,
      sourceRef: number,
      narration: `Credit note ${number} against ${invoice.number}: ${current.reason}`,
      idempotencyKey: `credit_note:${id}`,
      isDemo: invoice.isDemo,
      lines,
    });
    const after = await tx.creditNote.update({
      where: { id },
      data: {
        status: "ISSUED",
        number,
        baseTotalMinor,
        journalId: journal.id,
        issuedAt: new Date(),
        issuedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "credit_note.issued",
      targetType: "sales_invoice",
      targetId: invoice.id,
      legalEntityId: note.legalEntityId,
      metadata: {
        creditNoteId: id,
        number,
        invoice: invoice.number,
        journal: journal.number,
        totalMinor: after.totalMinor.toString(),
      },
    });
    return after;
  });
}

export async function discardCreditNote(actor: Actor, id: string) {
  const note = await loadCreditNote(actor, id);
  authorize(actor, "finance.edit", { legalEntityId: note.legalEntityId });
  return db.$transaction(async (tx) => {
    await lockNote(tx, id);
    const after = await tx.creditNote.update({ where: { id }, data: { status: "DISCARDED" } });
    await recordAudit(tx, actor, {
      action: "credit_note.discarded",
      targetType: "sales_invoice",
      targetId: note.invoiceId,
      legalEntityId: note.legalEntityId,
      metadata: { creditNoteId: id },
    });
    return after;
  });
}
