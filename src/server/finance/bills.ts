import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { BillStatus, SupplyType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { postDocumentCost, voidDocumentCost } from "@/server/projects/budget";
import { optionalId, requiredDate } from "@/server/projects/schemas";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseRate, toBaseMinor } from "@/lib/fx";
import { gstStateCode, supplyTypeFor } from "@/lib/gst";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { parsePercentToBps } from "@/lib/percent";
import { parseQuantity } from "@/lib/pricing";
import { tdsOn } from "@/lib/tds";
import { optionalText, requiredText } from "@/lib/validation";
import { entityTaxPosition, TAX_ACCOUNT_KEYS } from "./invoices";
import { postJournal, reverseJournal, systemAccount, type PostingLine } from "./ledger";
import { financeNumber } from "./numbering";

/*
 * Vendor bills (docs/payables.md).
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──void──▶ VOIDED
 *     ▲                  │reject
 *     └──────────────────┘
 *   DRAFT ──discard──▶ DISCARDED
 *
 * Finance enters bills (`finance.create`/`finance.edit`) and submits them
 * (`finance.submit`). The project manager of every project on the bill
 * approves it, or Finance (`finance.approve`) when it has no project or the
 * manager is away. Approval numbers the bill, posts it, and records each
 * project line as an actual cost against its budget line. An approved bill
 * with nothing paid can be voided (`finance.void`).
 */

type Tx = Prisma.TransactionClient;

export const BILL_STATUSES: Record<BillStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  APPROVED: "Approved",
  VOIDED: "Voided",
  DISCARDED: "Discarded",
};

/** MSME suppliers must be paid within 45 days (MSMED Act, section 15). */
export const MSME_MAX_DAYS = 45;

const DAY = 86_400_000;
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

/** Paid amounts of approved bills, in each bill's currency and in base as posted. */
export async function billSettlements(client: Tx | typeof db, billIds: string[]) {
  const rows = billIds.length
    ? await client.vendorPaymentAllocation.groupBy({
        by: ["billId"],
        where: { billId: { in: billIds }, voidedAt: null },
        _sum: { amountMinor: true, billBaseMinor: true },
      })
    : [];
  const map = new Map(billIds.map((id) => [id, { paidMinor: 0n, paidBaseMinor: 0n }]));
  for (const r of rows) {
    map.set(r.billId, {
      paidMinor: r._sum.amountMinor ?? 0n,
      paidBaseMinor: r._sum.billBaseMinor ?? 0n,
    });
  }
  return map;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function listBills(
  actor: Actor,
  options: {
    legalEntityId?: string | null;
    status?: BillStatus;
    vendorId?: string;
    search?: string;
  } = {},
) {
  authorize(actor, "finance.view");
  const q = options.search?.trim();
  const bills = await db.vendorBill.findMany({
    where: {
      ...entityFilter(actor, "finance.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.status ? { status: options.status } : { status: { not: "DISCARDED" } }),
      ...(options.vendorId ? { vendorId: options.vendorId } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { vendorInvoiceNumber: { contains: q, mode: "insensitive" } },
              { vendor: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: { vendor: { select: { id: true, name: true } } },
    orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  const settled = await billSettlements(
    db,
    bills.filter((b) => b.status === "APPROVED").map((b) => b.id),
  );
  return bills.map((b) => {
    const paid = settled.get(b.id)?.paidMinor ?? 0n;
    return {
      ...b,
      paidMinor: paid,
      outstandingMinor: b.status === "APPROVED" ? b.payableMinor - paid : 0n,
    };
  });
}

/** Whether the actor manages every project on the bill (and there is at least one). */
async function managesAllProjects(actor: Actor, billId: string) {
  const lines = await db.vendorBillLine.findMany({
    where: { billId },
    select: { project: { select: { projectManagerId: true } } },
  });
  return lines.length > 0 && lines.every((l) => l.project?.projectManagerId === actor.id);
}

async function loadBill(actor: Actor, id: string) {
  const bill = await db.vendorBill.findUnique({ where: { id } });
  if (!bill) throw new NotFoundError();
  // Project managers see the bills they are asked to approve.
  if (!can(actor, "finance.view", { legalEntityId: bill.legalEntityId })) {
    if (bill.status !== "SUBMITTED" && bill.status !== "APPROVED") throw new NotFoundError();
    if (!(await managesAllProjects(actor, id))) throw new NotFoundError();
  } else {
    await getLegalEntity(actor, bill.legalEntityId);
  }
  return bill;
}

async function canApprove(actor: Actor, bill: { id: string; legalEntityId: string }) {
  return (
    can(actor, "finance.approve", { legalEntityId: bill.legalEntityId }) ||
    (await managesAllProjects(actor, bill.id))
  );
}

export async function getBill(actor: Actor, id: string) {
  await loadBill(actor, id);
  const bill = await db.vendorBill.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: { select: { id: true, code: true, baseCurrency: true, timezone: true } },
      vendor: true,
      lines: {
        orderBy: { position: "asc" },
        include: {
          account: { select: { id: true, code: true, name: true } },
          project: { select: { id: true, number: true, name: true } },
        },
      },
      allocations: {
        where: { voidedAt: null },
        orderBy: { createdAt: "asc" },
        include: { payment: { select: { id: true, number: true, date: true } } },
      },
    },
  });
  const budgetLines = await db.projectBudgetLine.findMany({
    where: { id: { in: bill.lines.map((l) => l.budgetLineId).filter((x): x is string => !!x) } },
    select: { id: true, description: true },
  });
  const paidMinor = bill.allocations.reduce((s, a) => s + a.amountMinor, 0n);
  const scope = { legalEntityId: bill.legalEntityId };
  const approved = bill.status === "APPROVED";
  return {
    ...bill,
    budgetLines,
    paidMinor,
    outstandingMinor: approved ? bill.payableMinor - paidMinor : 0n,
    actions: {
      edit: bill.status === "DRAFT" && can(actor, "finance.edit", scope),
      submit: bill.status === "DRAFT" && can(actor, "finance.submit", scope),
      discard: bill.status === "DRAFT" && can(actor, "finance.edit", scope),
      approve: bill.status === "SUBMITTED" && (await canApprove(actor, bill)),
      reject: bill.status === "SUBMITTED" && (await canApprove(actor, bill)),
      pay: approved && bill.payableMinor - paidMinor > 0n && can(actor, "finance.post", scope),
      void: approved && paidMinor === 0n && can(actor, "finance.void", scope),
    },
  };
}

/** Submitted bills the actor can approve: as project manager, or with `finance.approve`. */
export async function billsAwaitingApproval(actor: Actor) {
  const bills = await db.vendorBill.findMany({
    where: { status: "SUBMITTED" },
    include: {
      vendor: { select: { name: true } },
      lines: {
        select: { project: { select: { id: true, number: true, projectManagerId: true } } },
      },
    },
    orderBy: { submittedAt: "asc" },
  });
  return bills.filter(
    (b) =>
      can(actor, "finance.approve", { legalEntityId: b.legalEntityId }) ||
      (b.lines.length > 0 && b.lines.every((l) => l.project?.projectManagerId === actor.id)),
  );
}

/** Vendors, accounts, projects with their budget lines, and tax rates for the bill editor. */
export async function billFormOptions(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.create", { legalEntityId });
  const [position, taxRates, accounts, projects] = await Promise.all([
    entityTaxPosition(db, legalEntityId),
    db.taxRate.findMany({
      where: { countryCode: entity.countryCode, status: "ACTIVE" },
      select: { id: true, code: true, name: true, rateBps: true, isDefault: true },
      orderBy: { rateBps: "desc" },
    }),
    db.ledgerAccount.findMany({
      where: {
        legalEntityId,
        status: "ACTIVE",
        isControl: false,
        OR: [{ type: "EXPENSE" }, { subtype: { in: ["FIXED_ASSET", "CURRENT_ASSET"] } }],
      },
      select: { id: true, code: true, name: true, subtype: true },
      orderBy: { code: "asc" },
    }),
    db.project.findMany({
      where: {
        legalEntityId,
        baselineLockedAt: { not: null },
        status: { notIn: ["CLOSED", "CANCELLED"] },
      },
      select: {
        id: true,
        number: true,
        name: true,
        currency: true,
        budgetLines: {
          select: { id: true, description: true, category: true },
          orderBy: { position: "asc" },
        },
      },
      orderBy: { number: "desc" },
    }),
  ]);
  const tax = { countryCode: position.countryCode, stateCode: position.stateCode };
  return { entity, tax, taxRates, accounts, projects };
}

/** What each commitment a bill line draws down is, for the editor. */
export async function commitmentLabels(ids: (string | null)[]) {
  const wanted = ids.filter((x): x is string => !!x);
  const rows = wanted.length
    ? await db.projectCostEntry.findMany({
        where: { id: { in: wanted } },
        select: { id: true, description: true, reference: true },
      })
    : [];
  return new Map(
    rows.map((r) => [r.id, r.reference ? `${r.reference}: ${r.description}` : r.description]),
  );
}

// ─── Drafting ────────────────────────────────────────────────────────────────

/** The supply type of a vendor's bill: their GST state against the entity's. */
export function vendorSupply(
  position: { countryCode: string; stateCode: string | null },
  vendor: { countryCode: string; gstin: string | null; region: string | null },
): SupplyType {
  return supplyTypeFor(position, {
    countryCode: vendor.countryCode,
    stateCode:
      vendor.countryCode === "IN"
        ? gstStateCode({ gstin: vendor.gstin, region: vendor.region })
        : null,
  });
}

/** Starts a draft bill from a vendor, with their currency, payment terms and usual TDS. */
export async function createBill(actor: Actor, legalEntityId: string, raw: { vendorId: string }) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.create", { legalEntityId });
  const { vendorId } = parseInput(
    z.object({ vendorId: z.uuid({ message: "Choose a vendor" }) }),
    raw,
  );
  const vendor = await db.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor || vendor.status !== "ACTIVE") throw invalid("vendorId", "Choose an active vendor");
  const position = await entityTaxPosition(db, legalEntityId);
  const terms = vendor.msmeNumber
    ? Math.min(vendor.paymentTermsDays, MSME_MAX_DAYS)
    : vendor.paymentTermsDays;
  const date = today();
  return db.$transaction(async (tx) => {
    const bill = await tx.vendorBill.create({
      data: {
        legalEntityId,
        vendorId,
        vendorInvoiceNumber: "",
        billDate: date,
        dueDate: new Date(date.getTime() + terms * DAY),
        currency: vendor.currency,
        supplyType: vendorSupply(position, vendor),
        vendorGstin: vendor.gstin,
        tdsSection: entity.countryCode === "IN" ? vendor.tdsSection : null,
        tdsRateBps: entity.countryCode === "IN" ? (vendor.tdsRateBps ?? 0) : 0,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "vendor_bill.drafted",
      targetType: "vendor_bill",
      targetId: bill.id,
      legalEntityId,
      metadata: { vendorId },
    });
    return bill;
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
  itcEligible: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === undefined || v === true || v === "true" || v === "on"),
  accountId: z.uuid({ message: "Choose an account" }),
  projectId: optionalId,
  budgetLineId: optionalId,
  // Set when the line bills a crew booking or a purchase order line.
  commitmentId: optionalId,
});
export type BillLineInput = z.input<typeof lineInput>;

const draftInput = z.object({
  vendorInvoiceNumber: requiredText(60),
  billDate: requiredDate,
  dueDate: requiredDate,
  currency: z.string().trim().toUpperCase().length(3, "Use a three-letter currency code"),
  fxRate: z.string().trim().nullish(),
  supplyType: z.enum(["INTRA_STATE", "INTER_STATE", "EXPORT", "NON_GST"]),
  tdsSection: optionalText(10),
  tdsRate: optionalText(10),
  notes: optionalText(2000),
  lines: z.array(lineInput).min(1, "Add at least one line").max(200),
});
export type BillDraftInput = z.input<typeof draftInput>;

export async function lockBill(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM vendor_bills WHERE id = ${id}::uuid FOR UPDATE`;
  const bill = await tx.vendorBill.findUnique({ where: { id } });
  if (!bill) throw new NotFoundError();
  return bill;
}

function requireStatus(bill: { status: BillStatus }, ...allowed: BillStatus[]) {
  if (!allowed.includes(bill.status)) {
    throw new ConflictError(
      `This bill is ${BILL_STATUSES[bill.status].toLowerCase()}, so it can't do that.`,
    );
  }
}

/** Saves a draft's header and lines, recalculating GST, TDS and totals. */
export async function saveBillDraft(actor: Actor, id: string, raw: BillDraftInput) {
  const before = await loadBill(actor, id);
  authorize(actor, "finance.edit", { legalEntityId: before.legalEntityId });
  const data = parseInput(draftInput, raw);
  if (data.dueDate! < data.billDate!)
    throw invalid("dueDate", "The due date can't be before the bill date");
  const entity = await db.legalEntity.findUniqueOrThrow({ where: { id: before.legalEntityId } });
  const vendor = await db.vendor.findUniqueOrThrow({ where: { id: before.vendorId } });
  if (
    vendor.msmeNumber &&
    data.dueDate!.getTime() - data.billDate!.getTime() > MSME_MAX_DAYS * DAY
  ) {
    throw invalid(
      "dueDate",
      `${vendor.name} is an MSME supplier: pay within ${MSME_MAX_DAYS} days`,
    );
  }
  const base = entity.baseCurrency;
  let fxRate: string | null = null;
  if (data.currency !== base) {
    if (!data.fxRate || parseRate(data.fxRate) === null) {
      throw invalid("fxRate", `Enter the rate in ${base} per 1 ${data.currency}`);
    }
    fxRate = data.fxRate;
  }
  if (entity.countryCode !== "IN" && data.supplyType !== "NON_GST") {
    throw invalid("supplyType", "Indian GST applies only to Indian entities");
  }
  if (entity.countryCode === "IN" && data.supplyType === "NON_GST") {
    throw invalid("supplyType", "Choose within the state, another state or import");
  }
  let tdsRateBps = 0;
  if (data.tdsRate) {
    const bps = parsePercentToBps(data.tdsRate);
    if (bps === null || bps > 3000) throw invalid("tdsRate", "Enter a rate such as 2 or 10");
    tdsRateBps = bps;
  }
  if (tdsRateBps && !data.tdsSection)
    throw invalid("tdsSection", "Enter the TDS section, such as 194C");
  if (tdsRateBps && data.currency !== base)
    throw invalid("tdsRate", `TDS is only deducted on bills in ${base}`);

  const commitmentIds = data.lines.map((l) => l.commitmentId).filter((x): x is string => !!x);
  const [rates, accounts, projects, commitments] = await Promise.all([
    db.taxRate.findMany({ where: { countryCode: entity.countryCode, status: "ACTIVE" } }),
    db.ledgerAccount.findMany({
      where: { legalEntityId: entity.id, status: "ACTIVE", isControl: false },
      select: { id: true, type: true, subtype: true },
    }),
    db.project.findMany({
      where: { id: { in: data.lines.map((l) => l.projectId).filter((x): x is string => !!x) } },
      include: { budgetLines: { select: { id: true } } },
    }),
    db.projectCostEntry.findMany({ where: { id: { in: commitmentIds }, kind: "COMMITMENT" } }),
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
    const account = accounts.find((a) => a.id === l.accountId);
    if (
      !account ||
      !(
        account.type === "EXPENSE" ||
        account.subtype === "FIXED_ASSET" ||
        account.subtype === "CURRENT_ASSET"
      )
    ) {
      throw invalid(`lines.${i}.accountId`, "Choose an expense or asset account of this entity");
    }
    if (l.projectId) {
      const project = projects.find((p) => p.id === l.projectId);
      if (!project || project.legalEntityId !== entity.id) {
        throw invalid(`lines.${i}.projectId`, "Choose a project of this entity");
      }
      if (!l.budgetLineId || !project.budgetLines.some((b) => b.id === l.budgetLineId)) {
        throw invalid(`lines.${i}.budgetLineId`, "Choose the budget line this cost belongs to");
      }
      if (project.currency !== data.currency && project.currency !== base) {
        throw invalid(`lines.${i}.projectId`, `Enter this bill in ${project.currency} or ${base}`);
      }
    } else if (l.budgetLineId) {
      throw invalid(`lines.${i}.projectId`, "Choose the project of the budget line");
    }
    if (l.commitmentId) {
      const commitment = commitments.find((c) => c.id === l.commitmentId);
      if (!commitment || commitment.voidedAt || commitment.budgetLineId !== l.budgetLineId) {
        throw invalid(
          `lines.${i}.budgetLineId`,
          "This line bills a booking or order on another budget line. Keep its budget line.",
        );
      }
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
      itcEligible: l.itcEligible,
      accountId: l.accountId,
      projectId: l.projectId ?? null,
      budgetLineId: l.projectId ? (l.budgetLineId ?? null) : null,
      commitmentId: l.projectId ? (l.commitmentId ?? null) : null,
      ...priceInvoiceLine({ quantityMilli, unitPriceMinor, taxRateBps }, data.supplyType),
    };
  });
  const totals = documentTotals(lines);
  const tdsMinor = tdsOn(totals.subtotalMinor, tdsRateBps, data.currency);
  return db.$transaction(async (tx) => {
    requireStatus(await lockBill(tx, id), "DRAFT");
    await tx.vendorBillLine.deleteMany({ where: { billId: id } });
    const after = await tx.vendorBill.update({
      where: { id },
      data: {
        vendorInvoiceNumber: data.vendorInvoiceNumber,
        billDate: data.billDate!,
        dueDate: data.dueDate!,
        currency: data.currency,
        fxRate,
        supplyType: data.supplyType,
        notes: data.notes,
        tdsSection: tdsRateBps ? data.tdsSection : null,
        tdsRateBps,
        tdsMinor,
        payableMinor: totals.totalMinor - tdsMinor,
        ...totals,
        lines: { create: lines },
      },
    });
    await recordAudit(tx, actor, {
      action: "vendor_bill.draft_saved",
      targetType: "vendor_bill",
      targetId: id,
      legalEntityId: after.legalEntityId,
      metadata: {
        totalMinor: after.totalMinor.toString(),
        tdsMinor: tdsMinor.toString(),
        lines: lines.length,
      },
    });
    return after;
  });
}

/** Another bill with the same supplier invoice number, so it isn't entered twice. */
async function duplicateOf(
  tx: Tx,
  bill: { id: string; legalEntityId: string; vendorId: string; vendorInvoiceNumber: string },
) {
  return tx.vendorBill.findFirst({
    where: {
      id: { not: bill.id },
      legalEntityId: bill.legalEntityId,
      vendorId: bill.vendorId,
      vendorInvoiceNumber: { equals: bill.vendorInvoiceNumber, mode: "insensitive" },
      status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] },
    },
    select: { number: true, status: true },
  });
}

export async function submitBill(actor: Actor, id: string) {
  const bill = await loadBill(actor, id);
  authorize(actor, "finance.submit", { legalEntityId: bill.legalEntityId });
  return db.$transaction(async (tx) => {
    const current = await lockBill(tx, id);
    requireStatus(current, "DRAFT");
    const lines = await tx.vendorBillLine.count({ where: { billId: id } });
    if (!lines || !current.vendorInvoiceNumber) {
      throw new ValidationError("Enter the supplier's invoice number and at least one line first.");
    }
    const duplicate = await duplicateOf(tx, current);
    if (duplicate) {
      throw new ConflictError(
        `Invoice ${current.vendorInvoiceNumber} from this vendor is already entered${duplicate.number ? ` as ${duplicate.number}` : " as a draft"}.`,
      );
    }
    const after = await tx.vendorBill.update({
      where: { id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        submittedById: actor.id,
        rejectedReason: null,
      },
    });
    await recordAudit(tx, actor, {
      action: "vendor_bill.submitted",
      targetType: "vendor_bill",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "DRAFT", to: "SUBMITTED" } },
    });
    return after;
  });
}

export async function rejectBill(actor: Actor, id: string, raw: { reason?: string | null }) {
  const bill = await loadBill(actor, id);
  if (!(await canApprove(actor, bill))) throw new ForbiddenError();
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  return db.$transaction(async (tx) => {
    requireStatus(await lockBill(tx, id), "SUBMITTED");
    const after = await tx.vendorBill.update({
      where: { id },
      data: { status: "DRAFT", rejectedReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "vendor_bill.rejected",
      targetType: "vendor_bill",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "SUBMITTED", to: "DRAFT" } },
      metadata: { reason },
    });
    return after;
  });
}

/**
 * A crew settlement's work is free to settle again once its bill is discarded
 * or voided (docs/crew.md, "Settlements").
 */
async function releaseCrewSettlement(tx: Tx, billId: string) {
  const settlement = await tx.crewSettlement.findUnique({ where: { billId } });
  if (!settlement || settlement.releasedAt) return;
  await tx.crewWorkRecord.updateMany({
    where: { settlementId: settlement.id },
    data: { settlementId: null },
  });
  await tx.crewSettlement.update({
    where: { id: settlement.id },
    data: { releasedAt: new Date() },
  });
}

export async function discardBill(actor: Actor, id: string) {
  const bill = await loadBill(actor, id);
  authorize(actor, "finance.edit", { legalEntityId: bill.legalEntityId });
  return db.$transaction(async (tx) => {
    requireStatus(await lockBill(tx, id), "DRAFT");
    const after = await tx.vendorBill.update({ where: { id }, data: { status: "DISCARDED" } });
    await releaseCrewSettlement(tx, id);
    await recordAudit(tx, actor, {
      action: "vendor_bill.discarded",
      targetType: "vendor_bill",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "DRAFT", to: "DISCARDED" } },
    });
    return after;
  });
}

// ─── Approving ───────────────────────────────────────────────────────────────

/**
 * Approves a submitted bill: numbers it, posts it, and records project costs.
 *
 *   Dr each line's account   taxable value (plus GST that can't be claimed)
 *   Dr input CGST/SGST/IGST  GST that can be claimed
 *   Cr TDS payable           TDS withheld
 *   Cr trade payables        what is owed to the vendor
 */
export async function approveBill(actor: Actor, id: string) {
  const bill = await loadBill(actor, id);
  if (!(await canApprove(actor, bill))) throw new ForbiddenError();
  return db.$transaction(async (tx) => {
    const current = await lockBill(tx, id);
    requireStatus(current, "SUBMITTED");
    const duplicate = await duplicateOf(tx, current);
    if (duplicate) {
      throw new ConflictError(
        `Invoice ${current.vendorInvoiceNumber} from this vendor is already entered.`,
      );
    }
    const [entity, vendor, lines] = await Promise.all([
      tx.legalEntity.findUniqueOrThrow({ where: { id: current.legalEntityId } }),
      tx.vendor.findUniqueOrThrow({ where: { id: current.vendorId } }),
      tx.vendorBillLine.findMany({
        where: { billId: id },
        include: { project: true },
        orderBy: { position: "asc" },
      }),
    ]);
    const base = entity.baseCurrency;
    const toBase = (minor: bigint) => toBaseMinor(minor, current.currency, base, current.fxRate);
    const fx =
      current.currency === base
        ? {}
        : { txCurrency: current.currency, fxRate: current.fxRate?.toString() ?? null };
    const { number } = await financeNumber(tx, actor, {
      documentType: "vendor_bill",
      legalEntityId: current.legalEntityId,
      date: current.billDate,
    });

    const posting: PostingLine[] = [];
    const itc = { cgstMinor: 0n, sgstMinor: 0n, igstMinor: 0n, otherTaxMinor: 0n };
    for (const l of lines) {
      const cost = l.amountMinor + (l.itcEligible ? 0n : l.taxMinor);
      if (l.itcEligible) {
        itc.cgstMinor += l.cgstMinor;
        itc.sgstMinor += l.sgstMinor;
        itc.igstMinor += l.igstMinor;
        itc.otherTaxMinor += l.otherTaxMinor;
      }
      const baseCost = toBase(cost);
      if (baseCost) {
        posting.push({
          accountId: l.accountId,
          debitMinor: baseCost,
          description: l.description,
          projectId: l.projectId,
          ...(fx.txCurrency ? { ...fx, txAmountMinor: cost } : {}),
        });
      }
      if (l.project && l.budgetLineId && cost > 0n) {
        const entry = await postDocumentCost(tx, actor, {
          projectId: l.project.id,
          budgetLineId: l.budgetLineId,
          amountMinor: l.project.currency === current.currency ? cost : baseCost,
          entryDate: current.billDate,
          description: l.description,
          supplier: vendor.name,
          reference: `${number} (${current.vendorInvoiceNumber})`,
          sourceType: "vendor_bill_line",
          sourceId: l.id,
          commitmentId: l.commitmentId,
          createdById: actor.id,
        });
        await tx.vendorBillLine.update({ where: { id: l.id }, data: { costEntryId: entry.id } });
      }
    }
    const keys = TAX_ACCOUNT_KEYS.input;
    for (const [component, key] of [
      ["cgstMinor", keys.cgst],
      ["sgstMinor", keys.sgst],
      ["igstMinor", keys.igst],
      ["otherTaxMinor", keys.other],
    ] as const) {
      const amount = toBase(itc[component]);
      if (!amount) continue;
      const account = await systemAccount(tx, current.legalEntityId, key);
      posting.push({
        accountId: account.id,
        debitMinor: amount,
        description: `Input ${component.replace("Minor", "").toUpperCase()}`,
      });
    }
    const tdsBase = toBase(current.tdsMinor);
    if (tdsBase) {
      const tdsPayable = await systemAccount(tx, current.legalEntityId, "TDS_PAYABLE");
      posting.push({
        accountId: tdsPayable.id,
        creditMinor: tdsBase,
        description: `TDS u/s ${current.tdsSection} on ${vendor.name}`,
        partyType: "VENDOR",
        partyId: vendor.id,
      });
    }
    // Payables balance the journal, so conversion rounding never unbalances it.
    const debits = posting.reduce((s, p) => s + (p.debitMinor ?? 0n), 0n);
    const basePayableMinor = debits - tdsBase;
    const payables = await systemAccount(tx, current.legalEntityId, "PAYABLES");
    posting.unshift({
      accountId: payables.id,
      creditMinor: basePayableMinor,
      description: `${vendor.name} invoice ${current.vendorInvoiceNumber}`,
      partyType: "VENDOR",
      partyId: vendor.id,
      ...(fx.txCurrency ? { ...fx, txAmountMinor: current.payableMinor } : {}),
    });
    const journal = await postJournal(tx, actor, {
      legalEntityId: current.legalEntityId,
      date: current.billDate,
      source: "VENDOR_BILL",
      sourceId: id,
      sourceRef: number,
      narration: `Bill ${number}: ${vendor.name} invoice ${current.vendorInvoiceNumber}`,
      idempotencyKey: `vendor_bill:${id}`,
      isDemo: current.isDemo,
      lines: posting,
    });
    const after = await tx.vendorBill.update({
      where: { id },
      data: {
        status: "APPROVED",
        number,
        vendorGstin: vendor.gstin,
        basePayableMinor,
        journalId: journal.id,
        approvedAt: new Date(),
        approvedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "vendor_bill.approved",
      targetType: "vendor_bill",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "SUBMITTED", to: "APPROVED" } },
      metadata: {
        number,
        journal: journal.number,
        totalMinor: after.totalMinor.toString(),
        tdsMinor: after.tdsMinor.toString(),
        currency: after.currency,
      },
    });
    return after;
  });
}

const voidInput = z.object({ date: requiredDate, reason: requiredText(500) });

/**
 * Voids an approved bill entered in error, before anything is paid on it:
 * reverses its journal and its project costs.
 */
export async function voidBill(actor: Actor, id: string, raw: z.input<typeof voidInput>) {
  const bill = await loadBill(actor, id);
  authorize(actor, "finance.void", { legalEntityId: bill.legalEntityId });
  const data = parseInput(voidInput, raw);
  if (data.date! < bill.billDate) throw invalid("date", "A bill can't be voided before its date");
  return db.$transaction(async (tx) => {
    const current = await lockBill(tx, id);
    requireStatus(current, "APPROVED");
    const paid = await tx.vendorPaymentAllocation.count({ where: { billId: id, voidedAt: null } });
    if (paid)
      throw new ConflictError("Payments are allocated to this bill. Void those payments first.");
    const reason = `Void of bill ${current.number}: ${data.reason}`;
    const reversal = await reverseJournal(tx, actor, current.journalId!, {
      date: data.date!,
      reason,
    });
    const lines = await tx.vendorBillLine.findMany({
      where: { billId: id, costEntryId: { not: null } },
    });
    for (const l of lines) await voidDocumentCost(tx, actor, l.costEntryId!, reason);
    await releaseCrewSettlement(tx, id);
    const after = await tx.vendorBill.update({
      where: { id },
      data: {
        status: "VOIDED",
        voidDate: data.date!,
        voidedAt: new Date(),
        voidReason: data.reason,
      },
    });
    await recordAudit(tx, actor, {
      action: "vendor_bill.voided",
      targetType: "vendor_bill",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "APPROVED", to: "VOIDED" } },
      metadata: { reason: data.reason, reversal: reversal.number },
    });
    return after;
  });
}
