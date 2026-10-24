import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { InvoiceKind, InvoiceStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { allocateNumber } from "@/server/numbering/service";
import { getLegalEntity } from "@/server/organisation/service";
import { optionalId, optionalDate, requiredDate } from "@/server/projects/schemas";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseRate, toBaseMinor } from "@/lib/fx";
import { GST_STATES, gstStateCode, supplyTypeFor, type SupplyType } from "@/lib/gst";
import { documentTotals, priceInvoiceLine, type PricedLine } from "@/lib/invoice";
import { INVOICE_KINDS, laterKinds, ONE_OFF_CLIENT_CODE } from "@/lib/invoice-kinds";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { parseQuantity, MILLI, roundDiv } from "@/lib/pricing";
import { optionalText, requiredText } from "@/lib/validation";
import { postJournal, systemAccount, type PostingLine } from "./ledger";
import { financeSettingsOf } from "./settings";

/*
 * Sales invoices (docs/invoicing.md).
 *
 *   DRAFT ──issue──▶ ISSUED      (numbered, posted to the ledger, frozen)
 *   DRAFT ──discard──▶ DISCARDED
 *
 * Issued invoices are corrected with credit notes (credit-notes.ts), never
 * edited or cancelled. Finance drafts (`finance.create`/`finance.edit`) and
 * issues (`finance.issue`); there is no approval step.
 *
 * Proforma and commercial invoices (src/lib/invoice-kinds.ts) take numbers
 * from the same series but never post: no receivable, no GST, no receipts
 * or credit notes against them. An issued one is turned into the next kind
 * with `makeInvoiceFrom`, which drafts a copy that gets its own number.
 */

type Tx = Prisma.TransactionClient;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

// ─── Parties and tax position ───────────────────────────────────────────────

/** The entity's GSTIN and GST state, from its active GSTIN registration or its address. */
export async function entityTaxPosition(client: Tx | typeof db, legalEntityId: string) {
  const entity = await client.legalEntity.findUniqueOrThrow({
    where: { id: legalEntityId },
    include: { taxRegistrations: { where: { status: "ACTIVE" } } },
  });
  const gstin =
    entity.taxRegistrations.find((t) => t.type.toUpperCase() === "GSTIN")?.value ?? null;
  return {
    entity,
    gstin,
    countryCode: entity.countryCode,
    stateCode: entity.countryCode === "IN" ? gstStateCode({ gstin, region: entity.region }) : null,
  };
}

export function clientGstin(client: { taxIdType: string | null; taxId: string | null }) {
  return client.taxIdType?.toUpperCase() === "GSTIN" ? client.taxId : null;
}

export function clientAddress(c: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
}) {
  return (
    [
      c.addressLine1,
      c.addressLine2,
      [c.city, c.region, c.postalCode].filter(Boolean).join(" "),
      c.countryCode,
    ]
      .filter(Boolean)
      .join(", ") || null
  );
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * Credited and paid amounts of issued invoices, in each invoice's currency
 * and in the base currency as posted. Paid is what live receipt allocations
 * (TDS included) have settled.
 */
export async function invoiceSettlements(client: Tx | typeof db, invoiceIds: string[]) {
  const [credits, allocations] = invoiceIds.length
    ? await Promise.all([
        client.creditNote.groupBy({
          by: ["invoiceId"],
          where: { invoiceId: { in: invoiceIds }, status: "ISSUED" },
          _sum: { totalMinor: true, baseTotalMinor: true },
        }),
        client.receiptAllocation.groupBy({
          by: ["invoiceId"],
          where: { invoiceId: { in: invoiceIds }, voidedAt: null },
          _sum: { amountMinor: true, invoiceBaseMinor: true },
        }),
      ])
    : [[], []];
  const map = new Map(
    invoiceIds.map((id) => [
      id,
      { creditedMinor: 0n, paidMinor: 0n, creditedBaseMinor: 0n, paidBaseMinor: 0n },
    ]),
  );
  for (const c of credits) {
    const s = map.get(c.invoiceId)!;
    s.creditedMinor = c._sum.totalMinor ?? 0n;
    s.creditedBaseMinor = c._sum.baseTotalMinor ?? 0n;
  }
  for (const a of allocations) {
    const s = map.get(a.invoiceId)!;
    s.paidMinor = a._sum.amountMinor ?? 0n;
    s.paidBaseMinor = a._sum.invoiceBaseMinor ?? 0n;
  }
  return map;
}

export async function listInvoices(
  actor: Actor,
  options: {
    legalEntityId?: string | null;
    status?: InvoiceStatus;
    kind?: InvoiceKind;
    clientId?: string;
    projectId?: string;
    search?: string;
  } = {},
) {
  authorize(actor, "finance.view");
  const q = options.search?.trim();
  const invoices = await db.salesInvoice.findMany({
    where: {
      ...entityFilter(actor, "finance.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.status ? { status: options.status } : { status: { not: "DISCARDED" } }),
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { clientName: { contains: q, mode: "insensitive" } },
              { clientPoNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      legalEntity: { select: { code: true } },
      project: { select: { id: true, number: true } },
    },
    orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  const settled = await invoiceSettlements(
    db,
    invoices.filter((i) => i.status === "ISSUED" && i.kind === "TAX").map((i) => i.id),
  );
  return invoices.map((i) => {
    const s = settled.get(i.id) ?? { creditedMinor: 0n, paidMinor: 0n };
    const owed = i.status === "ISSUED" && i.kind === "TAX";
    return {
      ...i,
      ...s,
      outstandingMinor: owed ? i.totalMinor - s.creditedMinor - s.paidMinor : 0n,
    };
  });
}

async function loadInvoice(actor: Actor, id: string) {
  const invoice = await db.salesInvoice.findUnique({ where: { id } });
  if (!invoice) throw new NotFoundError();
  await getLegalEntity(actor, invoice.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: invoice.legalEntityId });
  return invoice;
}

export async function getInvoice(actor: Actor, id: string) {
  await loadInvoice(actor, id);
  const invoice = await db.salesInvoice.findUniqueOrThrow({
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
          countryCode: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          region: true,
          postalCode: true,
          isDemo: true,
        },
      },
      client: { select: { id: true, name: true } },
      project: { select: { id: true, number: true, name: true, status: true } },
      milestone: { select: { id: true, label: true, amountMinor: true } },
      sourceInvoice: { select: { id: true, number: true, kind: true } },
      madeFrom: {
        where: { status: { not: "DISCARDED" } },
        select: { id: true, number: true, kind: true, status: true },
        orderBy: { createdAt: "asc" },
      },
      lines: { orderBy: { position: "asc" } },
      creditNotes: { where: { status: { not: "DISCARDED" } }, orderBy: { createdAt: "asc" } },
      allocations: {
        where: { voidedAt: null },
        orderBy: { createdAt: "asc" },
        include: { receipt: { select: { id: true, number: true, date: true, tdsMinor: true } } },
      },
    },
  });
  const settled = (await invoiceSettlements(db, [id])).get(id)!;
  const accounts = await db.ledgerAccount.findMany({
    where: { id: { in: invoice.lines.map((l) => l.revenueAccountId) } },
    select: { id: true, code: true, name: true },
  });
  const scope = { legalEntityId: invoice.legalEntityId };
  const draft = invoice.status === "DRAFT";
  const issued = invoice.status === "ISSUED";
  // Only a tax invoice is owed; the earlier kinds just ask for payment.
  const owed = issued && invoice.kind === "TAX";
  const outstandingMinor = owed
    ? invoice.totalMinor - settled.creditedMinor - settled.paidMinor
    : 0n;
  const made = new Set(invoice.madeFrom.map((m) => m.kind));
  const projectDone =
    !invoice.project || ["COMPLETED", "FINANCIAL_CLOSE", "CLOSED"].includes(invoice.project.status);
  return {
    ...invoice,
    ...settled,
    outstandingMinor,
    revenueAccounts: accounts,
    actions: {
      edit: draft && can(actor, "finance.edit", scope),
      issue: draft && can(actor, "finance.issue", scope),
      discard: draft && can(actor, "finance.edit", scope),
      credit: owed && outstandingMinor > 0n && can(actor, "finance.create", scope),
      receive: owed && outstandingMinor > 0n && can(actor, "finance.post", scope),
      makeFrom:
        issued && can(actor, "finance.create", scope)
          ? laterKinds(invoice.kind).filter((k) => !made.has(k))
          : [],
      recognise:
        owed &&
        invoice.revenueDeferred &&
        !invoice.revenueRecognisedAt &&
        projectDone &&
        can(actor, "finance.post", scope),
    },
  };
}

/** Clients, projects, tax rates and revenue accounts for an entity's invoice forms. */
export async function invoiceFormOptions(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.create", { legalEntityId });
  const [position, clients, projects, taxRates, revenueAccounts, services] = await Promise.all([
    entityTaxPosition(db, legalEntityId),
    db.client.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: { legalEntityId, clientId: { not: null }, status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: {
        id: true,
        number: true,
        name: true,
        clientId: true,
        milestones: {
          orderBy: { position: "asc" },
          select: { id: true, label: true, amountMinor: true, dueDate: true },
        },
      },
      orderBy: { number: "desc" },
    }),
    db.taxRate.findMany({
      where: { countryCode: entity.countryCode, status: "ACTIVE" },
      select: { id: true, code: true, name: true, rateBps: true, isDefault: true },
      orderBy: { rateBps: "desc" },
    }),
    db.ledgerAccount.findMany({
      where: { legalEntityId, status: "ACTIVE", type: "INCOME" },
      select: { id: true, code: true, name: true, systemKey: true },
      orderBy: { code: "asc" },
    }),
    db.invoiceService.findMany({
      where: { legalEntityId, status: "ACTIVE" },
      select: { code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const tax = {
    countryCode: position.countryCode,
    stateCode: position.stateCode,
    gstin: position.gstin,
  };
  return { entity, tax, clients, projects, taxRates, revenueAccounts, services };
}

// ─── Drafting ────────────────────────────────────────────────────────────────

const startInput = z.object({
  kind: z.enum(["PROFORMA", "COMMERCIAL", "TAX"]).default("TAX"),
  clientId: z.uuid({ message: "Choose a client" }),
  projectId: optionalId,
  milestoneId: optionalId,
});
export type StartInvoiceInput = z.input<typeof startInput>;

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

/**
 * Starts a draft invoice for a client, optionally for a project and one of
 * its billing milestones. A milestone draft gets one line for the
 * milestone's share of the contract value, at the entity's default GST rate.
 */
export async function createInvoice(actor: Actor, legalEntityId: string, raw: StartInvoiceInput) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.create", { legalEntityId });
  const input = parseInput(startInput, raw);
  const client = await db.client.findUnique({ where: { id: input.clientId } });
  if (!client || client.status !== "ACTIVE") throw invalid("clientId", "Choose an active client");
  const project = input.projectId
    ? await db.project.findUnique({
        where: { id: input.projectId },
        include: { milestones: true },
      })
    : null;
  if (input.projectId) {
    if (!project || project.legalEntityId !== legalEntityId) {
      throw invalid("projectId", "Choose a project of this entity");
    }
    if (project.clientId !== client.id)
      throw invalid("projectId", "The project is for another client");
  }
  const milestone = input.milestoneId
    ? project?.milestones.find((m) => m.id === input.milestoneId)
    : null;
  if (input.milestoneId && !milestone)
    throw invalid("milestoneId", "Choose a milestone of the project");

  return db.$transaction(async (tx) => {
    const position = await entityTaxPosition(tx, legalEntityId);
    const placeOfSupplyCode =
      client.countryCode === "IN"
        ? gstStateCode({ gstin: clientGstin(client), region: client.region })
        : null;
    const supplyType = supplyTypeFor(position, {
      countryCode: client.countryCode,
      stateCode: placeOfSupplyCode,
    });
    const currency = project?.currency ?? client.currency;
    const [defaultRate, revenue] = await Promise.all([
      tx.taxRate.findFirst({
        where: { countryCode: position.countryCode, isDefault: true, status: "ACTIVE" },
      }),
      systemAccount(tx, legalEntityId, "REVENUE"),
    ]);
    const lines: Prisma.SalesInvoiceLineCreateWithoutInvoiceInput[] = [];
    if (milestone && project) {
      const amountMinor = roundDiv(
        project.contractValueMinor * BigInt(milestone.percentBps),
        10_000n,
      );
      const priced = priceInvoiceLine(
        {
          quantityMilli: MILLI,
          unitPriceMinor: amountMinor,
          taxRateBps: defaultRate?.rateBps ?? 0,
        },
        supplyType,
      );
      lines.push({
        position: 0,
        description: `${milestone.label} — ${project.name}`,
        quantity: 1,
        unitPriceMinor: amountMinor,
        taxRateId: defaultRate?.id ?? null,
        taxCode: defaultRate?.code ?? null,
        taxRateBps: defaultRate?.rateBps ?? 0,
        revenueAccountId: revenue.id,
        ...priced,
      });
    }
    const totals = documentTotals(lines as unknown as PricedLine[]);
    const date = today();
    const invoice = await tx.salesInvoice.create({
      data: {
        legalEntityId,
        kind: input.kind,
        clientId: client.id,
        projectId: project?.id ?? null,
        milestoneId: milestone?.id ?? null,
        invoiceDate: date,
        dueDate: milestone?.dueDate && milestone.dueDate > date ? milestone.dueDate : date,
        currency,
        fxRate: currency === position.entity.baseCurrency ? null : (project?.fxRateToBase ?? null),
        supplyType,
        placeOfSupplyCode,
        placeOfSupplyCountry: client.countryCode,
        clientName: client.legalName ?? client.name,
        clientGstin: clientGstin(client),
        clientAddress: clientAddress(client),
        entityGstin: position.gstin,
        clientPoNumber: project?.clientPoNumber ?? null,
        createdById: actor.id,
        ...totals,
        lines: { create: lines },
      },
    });
    await recordAudit(tx, actor, {
      action: "sales_invoice.drafted",
      targetType: "sales_invoice",
      targetId: invoice.id,
      legalEntityId,
      metadata: {
        kind: input.kind,
        clientId: client.id,
        projectId: project?.id,
        milestoneId: milestone?.id,
      },
    });
    return invoice;
  });
}

const lineInput = z.object({
  description: requiredText(500),
  sacCode: z
    .string()
    .trim()
    .regex(/^(\d{4,8})?$/, "Use a 4 to 8 digit SAC or HSN code")
    .nullish()
    .transform((v) => v || null),
  quantity: z.string().trim().min(1, "Enter a quantity"),
  unitPrice: z.string().trim().min(1, "Enter a price"),
  taxRateId: optionalId,
  revenueAccountId: z.uuid({ message: "Choose a revenue account" }),
});
export type InvoiceLineInput = z.input<typeof lineInput>;

const draftInput = z.object({
  invoiceDate: requiredDate,
  dueDate: requiredDate,
  currency: z.string().trim().toUpperCase().length(3, "Use a three-letter currency code"),
  fxRate: z.string().trim().nullish(),
  fxNote: optionalText(200),
  placeOfSupplyCountry: z.string().trim().toUpperCase().length(2, "Choose a country"),
  placeOfSupplyCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => v || null),
  clientPoNumber: optionalText(100),
  serviceCode: optionalText(6),
  notes: optionalText(2000),
  lines: z.array(lineInput).min(1, "Add at least one line").max(200),
});
export type InvoiceDraftInput = z.input<typeof draftInput>;

export async function lockInvoice(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM sales_invoices WHERE id = ${id}::uuid FOR UPDATE`;
  const invoice = await tx.salesInvoice.findUnique({ where: { id } });
  if (!invoice) throw new NotFoundError();
  return invoice;
}

function requireDraft(invoice: { status: string }) {
  if (invoice.status !== "DRAFT") {
    throw new ConflictError(`This invoice is ${invoice.status.toLowerCase()}, so it can't change.`);
  }
}

/** Saves a draft's header and lines, recalculating tax and totals. */
export async function saveInvoiceDraft(actor: Actor, id: string, raw: InvoiceDraftInput) {
  const before = await loadInvoice(actor, id);
  authorize(actor, "finance.edit", { legalEntityId: before.legalEntityId });
  const data = parseInput(draftInput, raw);
  if (data.dueDate! < data.invoiceDate!)
    throw invalid("dueDate", "The due date can't be before the invoice date");
  const position = await entityTaxPosition(db, before.legalEntityId);
  const base = position.entity.baseCurrency;
  let fxRate: string | null = null;
  if (data.currency !== base) {
    if (!data.fxRate || parseRate(data.fxRate) === null) {
      throw invalid("fxRate", `Enter the rate in ${base} per 1 ${data.currency}`);
    }
    fxRate = data.fxRate;
  }
  if (data.placeOfSupplyCountry === "IN" && position.countryCode === "IN") {
    if (!data.placeOfSupplyCode || !(data.placeOfSupplyCode in GST_STATES)) {
      throw invalid("placeOfSupplyCode", "Choose the state of the place of supply");
    }
  }
  const placeOfSupplyCode = data.placeOfSupplyCountry === "IN" ? data.placeOfSupplyCode : null;
  const supplyType = supplyTypeFor(position, {
    countryCode: data.placeOfSupplyCountry,
    stateCode: placeOfSupplyCode,
  });
  if (data.serviceCode) {
    const service = await db.invoiceService.findFirst({
      where: { legalEntityId: before.legalEntityId, code: data.serviceCode, status: "ACTIVE" },
    });
    if (!service) throw invalid("serviceCode", "Choose an active service");
  }
  const [rates, accounts] = await Promise.all([
    db.taxRate.findMany({ where: { countryCode: position.countryCode, status: "ACTIVE" } }),
    db.ledgerAccount.findMany({
      where: { legalEntityId: before.legalEntityId, status: "ACTIVE", type: "INCOME" },
      select: { id: true },
    }),
  ]);
  const lines = data.lines.map((l, i) => {
    const quantityMilli = parseQuantity(l.quantity);
    if (quantityMilli === null || quantityMilli === 0n) {
      throw invalid(`lines.${i}.quantity`, "Enter a quantity above zero, up to 3 decimals");
    }
    const unitPriceMinor = parseMoneyToMinor(l.unitPrice, data.currency);
    if (unitPriceMinor === null || unitPriceMinor < 0n) {
      throw invalid(`lines.${i}.unitPrice`, "Enter a price of zero or more");
    }
    const rate = l.taxRateId ? rates.find((r) => r.id === l.taxRateId) : null;
    if (l.taxRateId && !rate) throw invalid(`lines.${i}.taxRateId`, "Choose an active tax rate");
    if (!accounts.some((a) => a.id === l.revenueAccountId)) {
      throw invalid(`lines.${i}.revenueAccountId`, "Choose an income account of this entity");
    }
    const taxRateBps = rate?.rateBps ?? 0;
    return {
      position: i,
      description: l.description,
      sacCode: l.sacCode,
      quantity: (Number(quantityMilli) / 1000).toFixed(3),
      unitPriceMinor,
      taxRateId: rate?.id ?? null,
      taxCode: rate?.code ?? null,
      taxRateBps,
      revenueAccountId: l.revenueAccountId,
      ...priceInvoiceLine({ quantityMilli, unitPriceMinor, taxRateBps }, supplyType),
    };
  });
  const totals = documentTotals(lines);
  return db.$transaction(async (tx) => {
    requireDraft(await lockInvoice(tx, id));
    await tx.salesInvoiceLine.deleteMany({ where: { invoiceId: id } });
    const after = await tx.salesInvoice.update({
      where: { id },
      data: {
        invoiceDate: data.invoiceDate!,
        dueDate: data.dueDate!,
        currency: data.currency,
        fxRate,
        fxNote: data.currency === base ? null : data.fxNote,
        supplyType,
        placeOfSupplyCode,
        placeOfSupplyCountry: data.placeOfSupplyCountry,
        clientPoNumber: data.clientPoNumber,
        serviceCode: data.serviceCode,
        notes: data.notes,
        ...totals,
        lines: { create: lines },
      },
    });
    await recordAudit(tx, actor, {
      action: "sales_invoice.draft_saved",
      targetType: "sales_invoice",
      targetId: id,
      legalEntityId: after.legalEntityId,
      metadata: {
        totalMinor: after.totalMinor.toString(),
        currency: after.currency,
        lines: lines.length,
      },
    });
    return after;
  });
}

export async function discardInvoice(actor: Actor, id: string) {
  const invoice = await loadInvoice(actor, id);
  authorize(actor, "finance.edit", { legalEntityId: invoice.legalEntityId });
  return db.$transaction(async (tx) => {
    requireDraft(await lockInvoice(tx, id));
    const after = await tx.salesInvoice.update({ where: { id }, data: { status: "DISCARDED" } });
    await recordAudit(tx, actor, {
      action: "sales_invoice.discarded",
      targetType: "sales_invoice",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "DRAFT", to: "DISCARDED" } },
    });
    return after;
  });
}

// ─── Issuing ─────────────────────────────────────────────────────────────────

export const TAX_ACCOUNT_KEYS = {
  output: { cgst: "OUTPUT_CGST", sgst: "OUTPUT_SGST", igst: "OUTPUT_IGST", other: "OUTPUT_TAX" },
  input: { cgst: "INPUT_CGST", sgst: "INPUT_SGST", igst: "INPUT_IGST", other: "INPUT_TAX" },
} as const;

/**
 * The ledger lines for an invoice-shaped document in the base currency:
 * income (or client advances when revenue is deferred) per line, each tax
 * component, and the receivable as the balancing total. `sign` 1 is an
 * invoice; -1 is a credit note, which reverses the same accounts.
 */
export async function salesPostingLines(
  tx: Tx,
  doc: {
    legalEntityId: string;
    clientId: string;
    projectId: string | null;
    currency: string;
    fxRate: Prisma.Decimal | string | null;
    deferred: boolean;
    lines: { revenueAccountId: string; amountMinor: bigint; description: string }[];
    tax: { cgstMinor: bigint; sgstMinor: bigint; igstMinor: bigint; otherTaxMinor: bigint };
    totalMinor: bigint;
  },
  baseCurrency: string,
  sign: 1 | -1,
) {
  const toBase = (minor: bigint) => toBaseMinor(minor, doc.currency, baseCurrency, doc.fxRate);
  const fx =
    doc.currency === baseCurrency
      ? {}
      : { txCurrency: doc.currency, fxRate: doc.fxRate?.toString() ?? null };
  const side = (
    amount: bigint,
    normallyCredit: boolean,
  ): Pick<PostingLine, "debitMinor" | "creditMinor"> =>
    normallyCredit === (sign === 1) ? { creditMinor: amount } : { debitMinor: amount };
  const advances = doc.deferred
    ? await systemAccount(tx, doc.legalEntityId, "CLIENT_ADVANCES")
    : null;
  const lines: PostingLine[] = doc.lines.map((l) => ({
    accountId: advances?.id ?? l.revenueAccountId,
    ...side(toBase(l.amountMinor), true),
    description: l.description,
    projectId: doc.projectId,
    ...fx,
    txAmountMinor: doc.currency === baseCurrency ? null : l.amountMinor,
  }));
  const components = [
    ["cgst", doc.tax.cgstMinor],
    ["sgst", doc.tax.sgstMinor],
    ["igst", doc.tax.igstMinor],
    ["other", doc.tax.otherTaxMinor],
  ] as const;
  for (const [key, minor] of components) {
    if (!minor) continue;
    const account = await systemAccount(tx, doc.legalEntityId, TAX_ACCOUNT_KEYS.output[key]);
    lines.push({ accountId: account.id, ...side(toBase(minor), true), projectId: doc.projectId });
  }
  const credits = lines.reduce((t, l) => t + (l.creditMinor ?? 0n) + (l.debitMinor ?? 0n), 0n);
  const receivables = await systemAccount(tx, doc.legalEntityId, "RECEIVABLES");
  lines.unshift({
    accountId: receivables.id,
    ...side(credits, false),
    partyType: "CLIENT",
    partyId: doc.clientId,
    projectId: doc.projectId,
    ...fx,
    txAmountMinor: doc.currency === baseCurrency ? null : doc.totalMinor,
  });
  return { lines, baseTotalMinor: credits };
}

/**
 * Issues a draft: gives it the next invoice number, copies the client's and
 * entity's details onto it, and posts it. Revenue goes to income, or to
 * client advances when the entity recognises revenue on completion.
 * A proforma or commercial invoice is numbered and frozen but not posted.
 */
export async function issueInvoice(actor: Actor, id: string) {
  const invoice = await loadInvoice(actor, id);
  authorize(actor, "finance.issue", { legalEntityId: invoice.legalEntityId });
  return db.$transaction(async (tx) => {
    const current = await lockInvoice(tx, id);
    requireDraft(current);
    const lines = await tx.salesInvoiceLine.findMany({
      where: { invoiceId: id },
      orderBy: { position: "asc" },
    });
    if (!lines.length || current.totalMinor <= 0n) {
      throw new ValidationError("Add at least one line with an amount before issuing.");
    }
    const position = await entityTaxPosition(tx, current.legalEntityId);
    if (current.currency !== position.entity.baseCurrency && !current.fxRate) {
      throw new ValidationError("Enter the exchange rate before issuing.");
    }
    if (
      current.supplyType !== "NON_GST" &&
      current.supplyType !== "EXPORT" &&
      !current.placeOfSupplyCode
    ) {
      throw new ValidationError("Choose the place of supply before issuing.");
    }
    if (position.countryCode === "IN" && !position.gstin) {
      throw new ConflictError(
        "Add the entity's GSTIN under Organisation before issuing tax invoices.",
      );
    }
    const client = await tx.client.findUniqueOrThrow({ where: { id: current.clientId } });
    const settings = await financeSettingsOf(tx, current.legalEntityId);
    const tax = current.kind === "TAX";
    const deferred =
      tax && settings.revenueRecognition === "ON_COMPLETION" && current.projectId !== null;
    const { number } = await allocateNumber(tx, {
      documentType: "sales_invoice",
      legalEntityId: current.legalEntityId,
      date: current.invoiceDate,
      fields: {
        CLIENT: client.invoiceCode ?? ONE_OFF_CLIENT_CODE,
        SERVICE: current.serviceCode,
      },
    });
    const { lines: posting, baseTotalMinor } = await salesPostingLines(
      tx,
      {
        ...current,
        deferred,
        lines,
        tax: current,
      },
      position.entity.baseCurrency,
      1,
    );
    const journal = tax
      ? await postJournal(tx, actor, {
          legalEntityId: current.legalEntityId,
          date: current.invoiceDate,
          source: "SALES_INVOICE",
          sourceId: id,
          sourceRef: number,
          narration: `Invoice ${number} to ${client.legalName ?? client.name}`,
          idempotencyKey: `sales_invoice:${id}`,
          isDemo: current.isDemo,
          lines: posting,
        })
      : null;
    const after = await tx.salesInvoice.update({
      where: { id },
      data: {
        status: "ISSUED",
        number,
        clientName: client.legalName ?? client.name,
        clientGstin: clientGstin(client),
        clientAddress: clientAddress(client),
        entityGstin: position.gstin,
        baseTotalMinor,
        revenueDeferred: deferred,
        journalId: journal?.id ?? null,
        issuedAt: new Date(),
        issuedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "sales_invoice.issued",
      targetType: "sales_invoice",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "DRAFT", to: "ISSUED" } },
      metadata: {
        kind: current.kind,
        number,
        journal: journal?.number ?? null,
        totalMinor: after.totalMinor.toString(),
        currency: after.currency,
        revenueDeferred: deferred,
      },
    });
    return after;
  });
}

const makeFromInput = z.object({ kind: z.enum(["COMMERCIAL", "TAX"]) });

/**
 * Drafts the next kind of invoice (commercial, or tax) from an issued
 * proforma or commercial invoice: same client, project, service and lines,
 * dated today. It gets its own number from the shared series when issued.
 * Each invoice is made into each later kind at most once.
 */
export async function makeInvoiceFrom(
  actor: Actor,
  id: string,
  raw: z.input<typeof makeFromInput>,
) {
  const source = await loadInvoice(actor, id);
  authorize(actor, "finance.create", { legalEntityId: source.legalEntityId });
  const { kind } = parseInput(makeFromInput, raw);
  if (source.status !== "ISSUED" || !laterKinds(source.kind).includes(kind)) {
    throw new ConflictError(
      `A ${INVOICE_KINDS[kind].label.toLowerCase()} is made from an issued ${
        kind === "TAX" ? "proforma or commercial" : "proforma"
      } invoice.`,
    );
  }
  return withUniqueConflict(
    `This invoice already has a ${INVOICE_KINDS[kind].label.toLowerCase()}.`,
    () =>
      db.$transaction(async (tx) => {
        await lockInvoice(tx, id);
        const lines = await tx.salesInvoiceLine.findMany({
          where: { invoiceId: id },
          orderBy: { position: "asc" },
        });
        const date = today();
        const draft = await tx.salesInvoice.create({
          data: {
            legalEntityId: source.legalEntityId,
            kind,
            sourceInvoiceId: id,
            clientId: source.clientId,
            projectId: source.projectId,
            milestoneId: source.milestoneId,
            invoiceDate: date,
            dueDate: source.dueDate > date ? source.dueDate : date,
            currency: source.currency,
            fxRate: source.fxRate,
            fxNote: source.fxNote,
            supplyType: source.supplyType,
            placeOfSupplyCode: source.placeOfSupplyCode,
            placeOfSupplyCountry: source.placeOfSupplyCountry,
            clientName: source.clientName,
            clientGstin: source.clientGstin,
            clientAddress: source.clientAddress,
            entityGstin: source.entityGstin,
            clientPoNumber: source.clientPoNumber,
            serviceCode: source.serviceCode,
            notes: source.notes,
            subtotalMinor: source.subtotalMinor,
            cgstMinor: source.cgstMinor,
            sgstMinor: source.sgstMinor,
            igstMinor: source.igstMinor,
            otherTaxMinor: source.otherTaxMinor,
            taxMinor: source.taxMinor,
            totalMinor: source.totalMinor,
            createdById: actor.id,
            isDemo: source.isDemo,
            lines: {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              create: lines.map(({ id: _id, invoiceId: _invoiceId, ...line }) => line),
            },
          },
        });
        await recordAudit(tx, actor, {
          action: "sales_invoice.drafted",
          targetType: "sales_invoice",
          targetId: draft.id,
          legalEntityId: draft.legalEntityId,
          metadata: { kind, madeFrom: source.number, sourceInvoiceId: id },
        });
        return draft;
      }),
  );
}

const recogniseInput = z.object({ date: optionalDate });

/**
 * Moves a deferred invoice's revenue from client advances to income, once
 * its project is completed (revenue recognition "on completion").
 */
export async function recogniseInvoiceRevenue(
  actor: Actor,
  id: string,
  raw: z.input<typeof recogniseInput> = {},
) {
  const invoice = await loadInvoice(actor, id);
  authorize(actor, "finance.post", { legalEntityId: invoice.legalEntityId });
  const { date } = parseInput(recogniseInput, raw);
  return db.$transaction(async (tx) => {
    const current = await lockInvoice(tx, id);
    if (current.status !== "ISSUED" || !current.revenueDeferred || current.revenueRecognisedAt) {
      throw new ConflictError("This invoice has no deferred revenue to recognise.");
    }
    if (current.projectId) {
      const project = await tx.project.findUniqueOrThrow({ where: { id: current.projectId } });
      if (!["COMPLETED", "FINANCIAL_CLOSE", "CLOSED"].includes(project.status)) {
        throw new ConflictError("Revenue is recognised once the project is completed.");
      }
    }
    const entity = await tx.legalEntity.findUniqueOrThrow({ where: { id: current.legalEntityId } });
    const advances = await systemAccount(tx, current.legalEntityId, "CLIENT_ADVANCES");
    const lines = await tx.salesInvoiceLine.findMany({ where: { invoiceId: id } });
    const credited = await tx.creditNoteLine.groupBy({
      by: ["invoiceLineId"],
      where: { creditNote: { invoiceId: id, status: "ISSUED" } },
      _sum: { amountMinor: true },
    });
    const posting: PostingLine[] = [];
    for (const l of lines) {
      const net =
        l.amountMinor - (credited.find((c) => c.invoiceLineId === l.id)?._sum.amountMinor ?? 0n);
      const base = toBaseMinor(net, current.currency, entity.baseCurrency, current.fxRate);
      if (!base) continue;
      posting.push(
        {
          accountId: advances.id,
          debitMinor: base,
          projectId: current.projectId,
          description: l.description,
        },
        {
          accountId: l.revenueAccountId,
          creditMinor: base,
          projectId: current.projectId,
          description: l.description,
        },
      );
    }
    const when = date ?? today();
    const journal = posting.length
      ? await postJournal(tx, actor, {
          legalEntityId: current.legalEntityId,
          date: when < current.invoiceDate ? current.invoiceDate : when,
          source: "SALES_INVOICE",
          sourceId: id,
          sourceRef: current.number,
          narration: `Revenue recognised on ${current.number}`,
          idempotencyKey: `sales_invoice:${id}:recognition`,
          isDemo: current.isDemo,
          lines: posting,
        })
      : null;
    const after = await tx.salesInvoice.update({
      where: { id },
      data: { revenueRecognisedAt: new Date(), recognitionJournalId: journal?.id ?? null },
    });
    await recordAudit(tx, actor, {
      action: "sales_invoice.revenue_recognised",
      targetType: "sales_invoice",
      targetId: id,
      legalEntityId: after.legalEntityId,
      metadata: { journal: journal?.number ?? null },
    });
    return after;
  });
}

export { GST_STATES, type SupplyType };
