import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { PurchaseOrderKind, PurchaseOrderStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { entityTaxPosition } from "@/server/finance/invoices";
import { vendorSupply } from "@/server/finance/bills";
import { financeNumber } from "@/server/finance/numbering";
import { getLegalEntity } from "@/server/organisation/service";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import {
  endDocumentCommitment,
  postDocumentCommitment,
  replaceDocumentCommitment,
} from "@/server/projects/budget";
import { assertChangeable } from "@/server/projects/projects";
import { optionalDate, optionalId, requiredDate } from "@/server/projects/schemas";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { formatQuantity, parseQuantity } from "@/lib/pricing";
import {
  amendFloorMilli,
  billableMilli,
  isMaterialAmendment,
  milli,
  needsApproval,
  stillOutMilli,
  toReceiveMilli,
  type LineProgress,
} from "@/lib/procurement";
import { optionalText, requiredText } from "@/lib/validation";
import { LIVE_BILL } from "./matching";
import { procurementSettingsOf } from "./settings";

/*
 * Purchase orders (spec §14; docs/procurement.md): an order to one vendor for
 * one project or cost centre.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──close──▶ CLOSED
 *     ▲                  │reject               │amend
 *     └──────────────────┘                     ▼
 *                    APPROVED ◀──approve── AMENDING ──withdraw──▶ APPROVED
 *
 * Whoever buys (`procurement.create`/`edit`/`submit`) raises the order. An
 * order whose subtotal is above the entity's threshold, or in another
 * currency, waits for `procurement.approve`; one at or below it is approved
 * when submitted. Approval numbers the order, keeps the approved version as a
 * revision, and commits each project line's cost to its budget line, so the
 * bill that follows draws the commitment down instead of adding to it.
 *
 * An approved order is changed through an amendment. While it is amended
 * nothing can be received or billed against it. An amendment that raises the
 * subtotal is material and needs approval again (above the threshold);
 * anything else applies when submitted. Withdrawing it restores the approved
 * version. Goods and rentals are billed up to what was received, services up
 * to what was ordered.
 */

type Tx = Prisma.TransactionClient;

export const ORDER_KINDS: Record<PurchaseOrderKind, string> = {
  SERVICES: "Services",
  RENTAL: "Rental",
  CONSUMABLES: "Consumables",
  EQUIPMENT: "Equipment purchase",
};

export const ORDER_STATUSES: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  APPROVED: "Approved",
  AMENDING: "Being amended",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const DAY_START = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const label = (o: { number: string | null }) => o.number ?? "This order";

// ─── Loading ─────────────────────────────────────────────────────────────────

async function loadOrder(actor: Actor, id: string) {
  const order = await db.purchaseOrder.findUnique({ where: { id } });
  if (!order || !can(actor, "procurement.view", { legalEntityId: order.legalEntityId })) {
    throw new NotFoundError();
  }
  return order;
}

async function lockOrder(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
  return tx.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } }, vendor: { select: { name: true } } },
  });
}

type LockedOrder = Awaited<ReturnType<typeof lockOrder>>;

function requireStatus(order: { status: PurchaseOrderStatus }, ...allowed: PurchaseOrderStatus[]) {
  if (!allowed.includes(order.status)) {
    throw new ConflictError(
      `This order is ${ORDER_STATUSES[order.status].toLowerCase()}, so that can't be done now.`,
    );
  }
}

/** What has been billed of each line, on bills that aren't discarded or voided. */
async function billedByLine(client: Tx | typeof db, lineIds: string[]) {
  const rows = lineIds.length
    ? await client.vendorBillLine.groupBy({
        by: ["purchaseOrderLineId"],
        where: { purchaseOrderLineId: { in: lineIds }, bill: LIVE_BILL },
        _sum: { quantity: true },
      })
    : [];
  return new Map(rows.map((r) => [r.purchaseOrderLineId!, milli(r._sum?.quantity)]));
}

function progressOf(
  line: { id: string; quantity: unknown; receivedQuantity: unknown; returnedQuantity: unknown },
  billed: Map<string, bigint>,
): LineProgress {
  return {
    orderedMilli: milli(line.quantity as string),
    receivedMilli: milli(line.receivedQuantity as string),
    returnedMilli: milli(line.returnedQuantity as string),
    billedMilli: billed.get(line.id) ?? 0n,
  };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function listOrders(
  actor: Actor,
  options: {
    legalEntityId?: string | null;
    status?: PurchaseOrderStatus;
    projectId?: string;
    vendorId?: string;
    search?: string;
    open?: boolean;
  } = {},
) {
  authorize(actor, "procurement.view");
  const q = options.search?.trim();
  return db.purchaseOrder.findMany({
    where: {
      ...entityFilter(actor, "procurement.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.status
        ? { status: options.status }
        : options.open
          ? { status: { notIn: ["CLOSED", "CANCELLED"] } }
          : {}),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.vendorId ? { vendorId: options.vendorId } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { vendor: { name: { contains: q, mode: "insensitive" } } },
              { project: { number: { contains: q, mode: "insensitive" } } },
              { lines: { some: { description: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      vendor: { select: { id: true, name: true } },
      project: { select: { id: true, number: true, name: true } },
      costCentre: { select: { code: true, name: true } },
      legalEntity: { select: { code: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
}

/** An order with its lines' progress, receipts, bills, revisions and what can be done next. */
export async function getOrder(actor: Actor, id: string) {
  await loadOrder(actor, id);
  const order = await db.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: { select: { id: true, code: true, baseCurrency: true } },
      vendor: { select: { id: true, name: true, currency: true, status: true } },
      project: {
        select: { id: true, number: true, name: true, currency: true, projectManagerId: true },
      },
      costCentre: { select: { id: true, code: true, name: true } },
      deliveryLocation: { select: { id: true, code: true, name: true } },
      lines: {
        orderBy: { position: "asc" },
        include: { budgetLine: { select: { id: true, description: true } } },
      },
      revisions: { orderBy: { revision: "desc" } },
      receipts: {
        orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
        include: {
          location: { select: { code: true } },
          lines: { select: { lineId: true, quantity: true } },
        },
      },
    },
  });
  const lineIds = order.lines.map((l) => l.id);
  const [billed, billRows, settings, people] = await Promise.all([
    billedByLine(db, lineIds),
    db.vendorBill.findMany({
      where: { lines: { some: { purchaseOrderLineId: { in: lineIds } } } },
      select: {
        id: true,
        number: true,
        status: true,
        vendorInvoiceNumber: true,
        billDate: true,
        currency: true,
        totalMinor: true,
      },
      orderBy: { billDate: "desc" },
    }),
    procurementSettingsOf(db, order.legalEntityId),
    db.user.findMany({
      where: {
        id: {
          in: [
            order.createdById,
            order.submittedById,
            order.approvedById,
            ...order.revisions.map((r) => r.approvedById),
            ...order.receipts.map((r) => r.createdById),
          ].filter((x): x is string => !!x),
        },
      },
      select: { id: true, name: true },
    }),
  ]);
  const lines = order.lines.map((l) => {
    const progress = progressOf(l, billed);
    return {
      ...l,
      progress,
      billableMilli: billableMilli(order.kind, progress),
      toReceiveMilli: toReceiveMilli(progress),
      stillOutMilli: stillOutMilli(progress),
    };
  });
  const scope = { legalEntityId: order.legalEntityId };
  const status = order.status;
  const amendment = order.revision > 0 && (status === "AMENDING" || status === "SUBMITTED");
  const untouched = lines.every((l) => !l.progress.receivedMilli && !l.progress.billedMilli);
  const edit = can(actor, "procurement.edit", scope);
  const willNeedApproval =
    status === "AMENDING"
      ? isMaterialAmendment(order.approvedSubtotalMinor ?? 0n, order.subtotalMinor) &&
        needsApproval({
          subtotalMinor: order.subtotalMinor,
          currency: order.currency,
          baseCurrency: order.legalEntity.baseCurrency,
          thresholdMinor: settings.approvalThresholdMinor,
        })
      : needsApproval({
          subtotalMinor: order.subtotalMinor,
          currency: order.currency,
          baseCurrency: order.legalEntity.baseCurrency,
          thresholdMinor: settings.approvalThresholdMinor,
        });
  const actions = {
    edit: (status === "DRAFT" || status === "AMENDING") && edit,
    submit:
      (status === "DRAFT" || status === "AMENDING") &&
      lines.length > 0 &&
      can(actor, "procurement.submit", scope),
    approve: status === "SUBMITTED" && can(actor, "procurement.approve", scope),
    reject: status === "SUBMITTED" && can(actor, "procurement.reject", scope),
    amend: status === "APPROVED" && edit,
    withdrawAmendment: amendment && edit,
    cancel:
      status === "DRAFT" || (status === "SUBMITTED" && !amendment)
        ? edit
        : (status === "APPROVED" || amendment) &&
          untouched &&
          can(actor, "procurement.approve", scope),
    close: status === "APPROVED" && edit,
    receive:
      status === "APPROVED" &&
      (edit || can(actor, "equipment.edit", scope)) &&
      lines.some((l) => l.toReceiveMilli > 0n),
    returnRental:
      status === "APPROVED" &&
      order.kind === "RENTAL" &&
      (edit || can(actor, "equipment.edit", scope)) &&
      lines.some((l) => l.stillOutMilli > 0n),
    bill:
      status === "APPROVED" &&
      can(actor, "finance.create", scope) &&
      lines.some((l) => l.billableMilli > 0n),
  };
  return {
    order: { ...order, lines },
    bills: billRows,
    names: new Map(people.map((p) => [p.id, p.name])),
    thresholdMinor: settings.approvalThresholdMinor,
    willNeedApproval,
    amendment,
    actions,
  };
}

/** What the order form offers: vendors, projects with approved budgets, cost centres, places, tax. */
export async function orderFormOptions(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "procurement.create", { legalEntityId });
  const [vendors, projects, costCentres, locations, taxRates] = await Promise.all([
    db.vendor.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, currency: true },
      orderBy: { name: "asc" },
    }),
    db.project.findMany({
      where: {
        legalEntityId,
        baselineLockedAt: { not: null },
        status: { notIn: ["CLOSED", "CANCELLED", "FINANCIAL_CLOSE"] },
      },
      select: { id: true, number: true, name: true, currency: true },
      orderBy: { number: "desc" },
    }),
    db.costCentre.findMany({
      where: { legalEntityId, status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    locationOptions(legalEntityId),
    taxRateOptions(entity.countryCode),
  ]);
  return { entity, vendors, projects, costCentres, locations, taxRates };
}

function locationOptions(legalEntityId: string) {
  return db.location.findMany({
    where: { status: "ACTIVE", OR: [{ legalEntityId }, { legalEntityId: null }] },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
}

function taxRateOptions(countryCode: string) {
  return db.taxRate.findMany({
    where: { countryCode, status: "ACTIVE" },
    select: { id: true, code: true, name: true, rateBps: true, isDefault: true },
    orderBy: { rateBps: "desc" },
  });
}

/** What the line editor of an existing order offers. */
export async function orderEditorOptions(actor: Actor, id: string) {
  const order = await loadOrder(actor, id);
  authorize(actor, "procurement.edit", { legalEntityId: order.legalEntityId });
  const entity = await db.legalEntity.findUniqueOrThrow({ where: { id: order.legalEntityId } });
  const [budgetLines, locations, taxRates] = await Promise.all([
    order.projectId
      ? db.projectBudgetLine.findMany({
          where: { projectId: order.projectId },
          select: { id: true, description: true, category: true },
          orderBy: { position: "asc" },
        })
      : Promise.resolve([]),
    locationOptions(order.legalEntityId),
    taxRateOptions(entity.countryCode),
  ]);
  return { budgetLines, locations, taxRates };
}

// ─── Creating and editing ────────────────────────────────────────────────────

const newOrderInput = z
  .object({
    vendorId: z.uuid({ message: "Choose a vendor" }),
    kind: z.enum(["SERVICES", "RENTAL", "CONSUMABLES", "EQUIPMENT"], {
      message: "Choose what is being bought",
    }),
    projectId: optionalId,
    costCentreId: optionalId,
  })
  .superRefine((v, ctx) => {
    if (!v.projectId === !v.costCentreId) {
      ctx.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Choose a project or a cost centre",
      });
    }
  });
export type NewOrderInput = z.input<typeof newOrderInput>;

/** Starts a draft order with the vendor's GST position and the project's (or vendor's) currency. */
export async function createOrder(actor: Actor, legalEntityId: string, raw: NewOrderInput) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "procurement.create", { legalEntityId });
  const data = parseInput(newOrderInput, raw);
  const vendor = await db.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor || vendor.status !== "ACTIVE") throw invalid("vendorId", "Choose an active vendor");
  let currency = vendor.currency;
  if (data.projectId) {
    const project = await db.project.findUnique({ where: { id: data.projectId } });
    if (!project || project.legalEntityId !== legalEntityId) {
      throw invalid("projectId", "Choose a project of this entity");
    }
    if (!project.baselineLockedAt) {
      throw invalid("projectId", `${project.number}'s budget isn't approved yet`);
    }
    assertChangeable(project);
    currency = project.currency;
  } else {
    const centre = await db.costCentre.findUnique({ where: { id: data.costCentreId! } });
    if (!centre || centre.legalEntityId !== legalEntityId || centre.status !== "ACTIVE") {
      throw invalid("costCentreId", "Choose an active cost centre of this entity");
    }
  }
  const position = await entityTaxPosition(db, entity.id);
  return db.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.create({
      data: {
        legalEntityId,
        kind: data.kind,
        vendorId: vendor.id,
        projectId: data.projectId,
        costCentreId: data.projectId ? null : data.costCentreId,
        currency,
        supplyType: vendorSupply(position, vendor),
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "purchase_order.created",
      targetType: "purchase_order",
      targetId: order.id,
      legalEntityId,
      metadata: {
        vendorId: vendor.id,
        kind: data.kind,
        projectId: data.projectId,
        costCentreId: order.costCentreId,
      },
    });
    return order;
  });
}

const lineInput = z.object({
  id: optionalId,
  description: requiredText(500),
  quantity: z.string().trim().min(1, "Enter a quantity"),
  unitPrice: z.string().trim().min(1, "Enter a price"),
  taxRateId: optionalId,
  budgetLineId: optionalId,
});
export type OrderLineInput = z.input<typeof lineInput>;

const orderInput = z.object({
  requiredDate: optionalDate,
  hireFrom: optionalDate,
  hireTo: optionalDate,
  deliveryLocationId: optionalId,
  deliveryNotes: optionalText(1000),
  terms: optionalText(2000),
  notes: optionalText(2000),
  supplyType: z.enum(["INTRA_STATE", "INTER_STATE", "EXPORT", "NON_GST"], {
    message: "Choose the GST supply type",
  }),
  lines: z.array(lineInput).min(1, "Add at least one line").max(100),
});
export type OrderInput = z.input<typeof orderInput>;

const HEADER_FIELDS = [
  "requiredDate",
  "hireFrom",
  "hireTo",
  "deliveryLocationId",
  "deliveryNotes",
  "terms",
  "notes",
  "supplyType",
  "subtotalMinor",
  "taxMinor",
  "totalMinor",
] as const;

/**
 * Saves a draft or an amendment: delivery, dates, terms and the lines. In an
 * amendment, lines keep their budget line, can't drop below what has arrived
 * or been billed, and can't be removed once anything was received or billed.
 */
export async function saveOrder(actor: Actor, id: string, raw: OrderInput) {
  const existing = await loadOrder(actor, id);
  authorize(actor, "procurement.edit", { legalEntityId: existing.legalEntityId });
  requireStatus(existing, "DRAFT", "AMENDING");
  const data = parseInput(orderInput, raw);
  if (existing.kind === "RENTAL") {
    if (!data.hireFrom) throw invalid("hireFrom", "Enter when the hire starts");
    if (!data.hireTo) throw invalid("hireTo", "Enter when the hire ends");
  }
  if (data.hireFrom && data.hireTo && data.hireTo < data.hireFrom) {
    throw invalid("hireTo", "The hire can't end before it starts");
  }
  const entity = await db.legalEntity.findUniqueOrThrow({ where: { id: existing.legalEntityId } });
  const [rates, budgetLines, location] = await Promise.all([
    db.taxRate.findMany({ where: { countryCode: entity.countryCode, status: "ACTIVE" } }),
    existing.projectId
      ? db.projectBudgetLine.findMany({
          where: { projectId: existing.projectId },
          select: { id: true },
        })
      : Promise.resolve([]),
    data.deliveryLocationId
      ? db.location.findUnique({ where: { id: data.deliveryLocationId } })
      : Promise.resolve(null),
  ]);
  if (
    data.deliveryLocationId &&
    (!location ||
      location.status !== "ACTIVE" ||
      (location.legalEntityId && location.legalEntityId !== entity.id))
  ) {
    throw invalid("deliveryLocationId", "Choose an active place of this entity");
  }
  const priced = data.lines.map((l, i) => {
    const quantityMilli = parseQuantity(l.quantity);
    if (quantityMilli === null || quantityMilli === 0n) {
      throw invalid(`lines.${i}.quantity`, "Enter a quantity above zero, up to 3 decimals");
    }
    const unitPriceMinor = parseMoneyToMinor(l.unitPrice, existing.currency);
    if (unitPriceMinor === null || unitPriceMinor < 0n) {
      throw invalid(`lines.${i}.unitPrice`, "Enter a price of zero or more");
    }
    const rate = l.taxRateId ? rates.find((r) => r.id === l.taxRateId) : null;
    if (l.taxRateId && !rate) throw invalid(`lines.${i}.taxRateId`, "Choose an active tax rate");
    if (existing.projectId) {
      if (!l.budgetLineId || !budgetLines.some((b) => b.id === l.budgetLineId)) {
        throw invalid(`lines.${i}.budgetLineId`, "Choose the budget line this cost belongs to");
      }
    } else if (l.budgetLineId) {
      throw invalid(`lines.${i}.budgetLineId`, "Orders for a cost centre have no budget lines");
    }
    const taxRateBps = rate?.rateBps ?? 0;
    const price = priceInvoiceLine({ quantityMilli, unitPriceMinor, taxRateBps }, data.supplyType);
    return {
      id: l.id,
      position: i,
      description: l.description,
      quantityMilli,
      quantity: formatQuantity(quantityMilli),
      unitPriceMinor,
      taxRateId: rate?.id ?? null,
      taxRateBps,
      budgetLineId: l.budgetLineId,
      ...price,
    };
  });
  const totals = documentTotals(priced);

  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "DRAFT", "AMENDING");
    const billed = await billedByLine(
      tx,
      order.lines.map((l) => l.id),
    );
    const kept = new Set(priced.map((p) => p.id).filter(Boolean));
    for (const [i, p] of priced.entries()) {
      if (!p.id) continue;
      const before = order.lines.find((l) => l.id === p.id);
      if (!before) throw invalid(`lines.${i}.description`, "This line isn't on the order");
      if (order.status !== "AMENDING") continue;
      if (before.budgetLineId !== p.budgetLineId) {
        throw invalid(
          `lines.${i}.budgetLineId`,
          "An approved line keeps its budget line. Add a new line instead.",
        );
      }
      const floor = amendFloorMilli(progressOf(before, billed));
      if (p.quantityMilli < floor) {
        throw invalid(
          `lines.${i}.quantity`,
          `${formatQuantity(floor)} already received or billed, so it can't go lower`,
        );
      }
    }
    const removed = order.lines.filter((l) => !kept.has(l.id));
    if (removed.length) {
      const used = await tx.purchaseOrderLine.findMany({
        where: {
          id: { in: removed.map((l) => l.id) },
          OR: [{ receiptLines: { some: {} } }, { billLines: { some: {} } }],
        },
        select: { description: true },
      });
      if (used.length) {
        throw new ConflictError(
          `"${used[0]!.description}" has been received or billed, so it stays on the order. Lower its quantity instead.`,
        );
      }
      await tx.purchaseOrderLine.deleteMany({ where: { id: { in: removed.map((l) => l.id) } } });
    }
    for (const p of priced) {
      const row = {
        position: p.position,
        description: p.description,
        quantity: p.quantity,
        unitPriceMinor: p.unitPriceMinor,
        amountMinor: p.amountMinor,
        taxRateId: p.taxRateId,
        taxRateBps: p.taxRateBps,
        taxMinor: p.taxMinor,
        totalMinor: p.totalMinor,
        budgetLineId: p.budgetLineId,
      };
      if (p.id) await tx.purchaseOrderLine.update({ where: { id: p.id }, data: row });
      else await tx.purchaseOrderLine.create({ data: { ...row, purchaseOrderId: id } });
    }
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: {
        requiredDate: data.requiredDate,
        hireFrom: data.hireFrom,
        hireTo: data.hireTo,
        deliveryLocationId: data.deliveryLocationId,
        deliveryNotes: data.deliveryNotes,
        terms: data.terms,
        notes: data.notes,
        supplyType: data.supplyType,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
      },
    });
    await recordAudit(tx, actor, {
      action:
        order.status === "AMENDING" ? "purchase_order.amendment_saved" : "purchase_order.saved",
      targetType: "purchase_order",
      targetId: id,
      legalEntityId: order.legalEntityId,
      changes: diffChanges(order, after, HEADER_FIELDS),
      metadata: { lines: priced.length },
    });
    return after;
  });
}

// ─── Approval ────────────────────────────────────────────────────────────────

type Snapshot = {
  requiredDate: string | null;
  hireFrom: string | null;
  hireTo: string | null;
  deliveryLocationId: string | null;
  deliveryNotes: string | null;
  terms: string | null;
  notes: string | null;
  supplyType: LockedOrder["supplyType"];
  subtotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  lines: {
    id: string;
    position: number;
    description: string;
    quantity: string;
    unitPriceMinor: string;
    amountMinor: string;
    taxRateId: string | null;
    taxRateBps: number;
    taxMinor: string;
    totalMinor: string;
    budgetLineId: string | null;
    commitmentId: string | null;
  }[];
};

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const fromIso = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);

function snapshotOf(order: LockedOrder): Snapshot {
  return {
    requiredDate: isoDate(order.requiredDate),
    hireFrom: isoDate(order.hireFrom),
    hireTo: isoDate(order.hireTo),
    deliveryLocationId: order.deliveryLocationId,
    deliveryNotes: order.deliveryNotes,
    terms: order.terms,
    notes: order.notes,
    supplyType: order.supplyType,
    subtotalMinor: order.subtotalMinor.toString(),
    taxMinor: order.taxMinor.toString(),
    totalMinor: order.totalMinor.toString(),
    lines: order.lines.map((l) => ({
      id: l.id,
      position: l.position,
      description: l.description,
      quantity: l.quantity.toString(),
      unitPriceMinor: l.unitPriceMinor.toString(),
      amountMinor: l.amountMinor.toString(),
      taxRateId: l.taxRateId,
      taxRateBps: l.taxRateBps,
      taxMinor: l.taxMinor.toString(),
      totalMinor: l.totalMinor.toString(),
      budgetLineId: l.budgetLineId,
      commitmentId: l.commitmentId,
    })),
  };
}

/** Reads a stored revision snapshot. */
export function readSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object" || !Array.isArray((value as Snapshot).lines)) return null;
  return value as Snapshot;
}

async function latestSnapshot(tx: Tx, orderId: string) {
  const revision = await tx.purchaseOrderRevision.findFirst({
    where: { purchaseOrderId: orderId },
    orderBy: { revision: "desc" },
  });
  return revision ? readSnapshot(revision.snapshot) : null;
}

/**
 * Approves a locked order: numbers it the first time, brings its project
 * commitments into line with the lines, and keeps this version as a revision.
 */
async function approveLocked(tx: Tx, actor: Actor, order: LockedOrder, auto: boolean) {
  const today = DAY_START();
  const number =
    order.number ??
    (
      await financeNumber(tx, actor, {
        documentType: "purchase_order",
        legalEntityId: order.legalEntityId,
        date: today,
      })
    ).number;
  if (order.projectId) {
    const previous = order.revision ? await latestSnapshot(tx, order.id) : null;
    const current = new Set(order.lines.map((l) => l.commitmentId).filter(Boolean));
    for (const old of previous?.lines ?? []) {
      if (old.commitmentId && !current.has(old.commitmentId)) {
        await endDocumentCommitment(tx, actor, old.commitmentId, `${number}: line removed`);
      }
    }
    for (const line of order.lines) {
      if (!line.budgetLineId) continue;
      const input = {
        projectId: order.projectId,
        budgetLineId: line.budgetLineId,
        amountMinor: line.amountMinor,
        entryDate: today,
        description: line.description,
        supplier: order.vendor.name,
        reference: order.revision ? `${number} rev ${order.revision + 1}` : number,
        sourceType: "purchase_order_line" as const,
        sourceId: line.id,
        createdById: actor.id,
      };
      let commitmentId = line.commitmentId;
      if (commitmentId) {
        commitmentId =
          (await replaceDocumentCommitment(tx, actor, commitmentId, input))?.id ?? null;
      } else if (line.amountMinor > 0n) {
        commitmentId = (await postDocumentCommitment(tx, actor, input)).id;
      }
      if (commitmentId !== line.commitmentId) {
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { commitmentId } });
        line.commitmentId = commitmentId;
      }
    }
  }
  const revision = order.revision + 1;
  await tx.purchaseOrderRevision.create({
    data: {
      purchaseOrderId: order.id,
      revision,
      snapshot: snapshotOf(order) as unknown as Prisma.InputJsonValue,
      reason: order.amendmentReason,
      subtotalMinor: order.subtotalMinor,
      totalMinor: order.totalMinor,
      approvedById: actor.id,
    },
  });
  const now = new Date();
  const after = await tx.purchaseOrder.update({
    where: { id: order.id },
    data: {
      number,
      status: "APPROVED",
      revision,
      approvedSubtotalMinor: order.subtotalMinor,
      approvedAt: now,
      approvedById: actor.id,
      amendmentReason: null,
      rejectedReason: null,
      ...(auto ? { submittedAt: now, submittedById: actor.id } : {}),
    },
  });
  await recordAudit(tx, actor, {
    action: "purchase_order.approved",
    targetType: "purchase_order",
    targetId: order.id,
    legalEntityId: order.legalEntityId,
    metadata: {
      number,
      revision,
      // Approved on submission because it was at or below the threshold.
      auto,
      subtotalMinor: order.subtotalMinor.toString(),
      ...(order.amendmentReason ? { reason: order.amendmentReason } : {}),
    },
  });
  return after;
}

/**
 * Sends a draft or an amendment for approval, or approves it straight away
 * when it is within the entity's threshold (or, for an amendment, doesn't
 * raise the subtotal).
 */
export async function submitOrder(actor: Actor, id: string) {
  const existing = await loadOrder(actor, id);
  authorize(actor, "procurement.submit", { legalEntityId: existing.legalEntityId });
  const entity = await db.legalEntity.findUniqueOrThrow({ where: { id: existing.legalEntityId } });
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "DRAFT", "AMENDING");
    if (!order.lines.length) throw new ConflictError("Add at least one line first.");
    if (order.kind === "RENTAL" && (!order.hireFrom || !order.hireTo)) {
      throw new ConflictError("Enter the hire period first.");
    }
    const settings = await procurementSettingsOf(tx, order.legalEntityId);
    const overThreshold = needsApproval({
      subtotalMinor: order.subtotalMinor,
      currency: order.currency,
      baseCurrency: entity.baseCurrency,
      thresholdMinor: settings.approvalThresholdMinor,
    });
    const need =
      order.status === "AMENDING"
        ? overThreshold &&
          isMaterialAmendment(order.approvedSubtotalMinor ?? 0n, order.subtotalMinor)
        : overThreshold;
    if (!need) return approveLocked(tx, actor, order, true);
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        submittedById: actor.id,
        rejectedReason: null,
      },
    });
    await recordAudit(tx, actor, {
      action: "purchase_order.submitted",
      targetType: "purchase_order",
      targetId: id,
      legalEntityId: order.legalEntityId,
      metadata: {
        subtotalMinor: order.subtotalMinor.toString(),
        thresholdMinor: settings.approvalThresholdMinor.toString(),
        amendment: order.revision > 0,
      },
    });
    return after;
  });
}

export async function approveOrder(actor: Actor, id: string) {
  const existing = await loadOrder(actor, id);
  authorize(actor, "procurement.approve", { legalEntityId: existing.legalEntityId });
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "SUBMITTED");
    return approveLocked(tx, actor, order, false);
  });
}

const reasonInput = z.object({ reason: requiredText(1000) });

/** Sends a submitted order or amendment back to be changed. */
export async function rejectOrder(actor: Actor, id: string, raw: { reason?: string | null }) {
  const existing = await loadOrder(actor, id);
  authorize(actor, "procurement.reject", { legalEntityId: existing.legalEntityId });
  const { reason } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "SUBMITTED");
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: { status: order.revision > 0 ? "AMENDING" : "DRAFT", rejectedReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "purchase_order.rejected",
      targetType: "purchase_order",
      targetId: id,
      legalEntityId: order.legalEntityId,
      metadata: { reason, amendment: order.revision > 0 },
    });
    return after;
  });
}

// ─── Amendments ──────────────────────────────────────────────────────────────

/** Opens an approved order for changes. Nothing is received or billed until it is approved again. */
export async function startAmendment(actor: Actor, id: string, raw: { reason?: string | null }) {
  const existing = await loadOrder(actor, id);
  authorize(actor, "procurement.edit", { legalEntityId: existing.legalEntityId });
  const { reason } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "APPROVED");
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "AMENDING", amendmentReason: reason, rejectedReason: null },
    });
    await recordAudit(tx, actor, {
      action: "purchase_order.amendment_started",
      targetType: "purchase_order",
      targetId: id,
      legalEntityId: order.legalEntityId,
      metadata: { reason, revision: order.revision },
    });
    return after;
  });
}

/** Drops an amendment and puts the last approved version back. */
export async function withdrawAmendment(actor: Actor, id: string) {
  const existing = await loadOrder(actor, id);
  authorize(actor, "procurement.edit", { legalEntityId: existing.legalEntityId });
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "AMENDING", "SUBMITTED");
    if (order.revision === 0) throw new ConflictError("This order has no approved version yet.");
    const snapshot = await latestSnapshot(tx, id);
    if (!snapshot) throw new ConflictError("The approved version couldn't be read.");
    await restoreSnapshot(tx, order, snapshot);
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "APPROVED", amendmentReason: null, rejectedReason: null },
    });
    await recordAudit(tx, actor, {
      action: "purchase_order.amendment_withdrawn",
      targetType: "purchase_order",
      targetId: id,
      legalEntityId: order.legalEntityId,
      metadata: { revision: order.revision, reason: order.amendmentReason },
    });
    return after;
  });
}

async function restoreSnapshot(tx: Tx, order: LockedOrder, snapshot: Snapshot) {
  const keep = new Set(snapshot.lines.map((l) => l.id));
  const added = order.lines.filter((l) => !keep.has(l.id)).map((l) => l.id);
  if (added.length) await tx.purchaseOrderLine.deleteMany({ where: { id: { in: added } } });
  for (const l of snapshot.lines) {
    const row = {
      position: l.position,
      description: l.description,
      quantity: l.quantity,
      unitPriceMinor: BigInt(l.unitPriceMinor),
      amountMinor: BigInt(l.amountMinor),
      taxRateId: l.taxRateId,
      taxRateBps: l.taxRateBps,
      taxMinor: BigInt(l.taxMinor),
      totalMinor: BigInt(l.totalMinor),
      budgetLineId: l.budgetLineId,
      commitmentId: l.commitmentId,
    };
    if (order.lines.some((x) => x.id === l.id)) {
      await tx.purchaseOrderLine.update({ where: { id: l.id }, data: row });
    } else {
      await tx.purchaseOrderLine.create({ data: { ...row, id: l.id, purchaseOrderId: order.id } });
    }
  }
  await tx.purchaseOrder.update({
    where: { id: order.id },
    data: {
      requiredDate: fromIso(snapshot.requiredDate),
      hireFrom: fromIso(snapshot.hireFrom),
      hireTo: fromIso(snapshot.hireTo),
      deliveryLocationId: snapshot.deliveryLocationId,
      deliveryNotes: snapshot.deliveryNotes,
      terms: snapshot.terms,
      notes: snapshot.notes,
      supplyType: snapshot.supplyType,
      subtotalMinor: BigInt(snapshot.subtotalMinor),
      taxMinor: BigInt(snapshot.taxMinor),
      totalMinor: BigInt(snapshot.totalMinor),
    },
  });
}

// ─── Ending ──────────────────────────────────────────────────────────────────

async function endCommitments(tx: Tx, actor: Actor, order: LockedOrder, reason: string) {
  for (const line of order.lines) {
    if (line.commitmentId) await endDocumentCommitment(tx, actor, line.commitmentId, reason);
  }
}

/**
 * Cancels an order. Drafts are cancelled by whoever edits orders; an approved
 * order only by an approver, and only while nothing was received or billed.
 */
export async function cancelOrder(actor: Actor, id: string, raw: { reason?: string | null }) {
  const existing = await loadOrder(actor, id);
  const scope = { legalEntityId: existing.legalEntityId };
  const { reason } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "DRAFT", "SUBMITTED", "APPROVED", "AMENDING");
    if (order.revision === 0) {
      authorize(actor, "procurement.edit", scope);
    } else {
      authorize(actor, "procurement.approve", scope);
      const billed = await billedByLine(
        tx,
        order.lines.map((l) => l.id),
      );
      if (order.lines.some((l) => milli(l.receivedQuantity) > 0n || billed.get(l.id))) {
        throw new ConflictError(
          `${label(order)} has been received or billed, so it can't be cancelled. Close it instead.`,
        );
      }
      if (order.status !== "APPROVED") {
        const snapshot = await latestSnapshot(tx, id);
        if (snapshot) await restoreSnapshot(tx, order, snapshot);
      }
      await endCommitments(tx, actor, await lockOrder(tx, id), `${label(order)} cancelled`);
    }
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED", closedAt: new Date(), closedReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "purchase_order.cancelled",
      targetType: "purchase_order",
      targetId: id,
      legalEntityId: order.legalEntityId,
      metadata: { reason, number: order.number },
    });
    return after;
  });
}

/**
 * Closes an approved order: what hasn't been billed is released from the
 * project's commitments. Refused while rentals are still out or a bill
 * against it is still in progress.
 */
export async function closeOrder(actor: Actor, id: string, raw: { reason?: string | null }) {
  const existing = await loadOrder(actor, id);
  authorize(actor, "procurement.edit", { legalEntityId: existing.legalEntityId });
  const { reason } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "APPROVED");
    if (
      order.kind === "RENTAL" &&
      order.lines.some((l) => milli(l.receivedQuantity) > milli(l.returnedQuantity))
    ) {
      throw new ConflictError(
        `Some of ${label(order)} is still on hire. Record its return to the vendor first.`,
      );
    }
    const pending = await tx.vendorBill.findFirst({
      where: {
        status: { in: ["DRAFT", "SUBMITTED"] },
        lines: { some: { purchaseOrderLineId: { in: order.lines.map((l) => l.id) } } },
      },
      select: { vendorInvoiceNumber: true },
    });
    if (pending) {
      throw new ConflictError(
        `A bill against ${label(order)}${pending.vendorInvoiceNumber ? ` (${pending.vendorInvoiceNumber})` : ""} is still in progress. Approve or discard it first.`,
      );
    }
    await endCommitments(tx, actor, order, `${label(order)} closed`);
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date(), closedReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "purchase_order.closed",
      targetType: "purchase_order",
      targetId: id,
      legalEntityId: order.legalEntityId,
      metadata: { reason, number: order.number },
    });
    return after;
  });
}

// ─── Receiving ───────────────────────────────────────────────────────────────

const receiptInput = z.object({
  kind: z.enum(["RECEIVED", "RETURNED"]).default("RECEIVED"),
  receivedOn: requiredDate,
  locationId: optionalId,
  reference: optionalText(100),
  notes: optionalText(1000),
  quantities: z.record(z.string(), z.string()),
});
export type ReceiptInput = z.input<typeof receiptInput>;

/**
 * Records goods (or a service) received against an approved order, in part
 * or in full, or rented items handed back to the vendor. Whoever buys or
 * keeps the warehouse records it.
 */
export async function recordReceipt(actor: Actor, id: string, raw: ReceiptInput) {
  const existing = await loadOrder(actor, id);
  const scope = { legalEntityId: existing.legalEntityId };
  if (!can(actor, "procurement.edit", scope) && !can(actor, "equipment.edit", scope)) {
    throw new ForbiddenError();
  }
  const data = parseInput(receiptInput, raw);
  if (data.kind === "RETURNED" && existing.kind !== "RENTAL") {
    throw new ConflictError("Only rentals are returned to the vendor.");
  }
  if (data.receivedOn! > DAY_START()) throw invalid("receivedOn", "Enter today or an earlier date");
  if (data.locationId) {
    const location = await db.location.findUnique({ where: { id: data.locationId } });
    if (!location || location.status !== "ACTIVE") {
      throw invalid("locationId", "Choose an active place");
    }
  }
  const wanted = Object.entries(data.quantities).flatMap(([lineId, text]) => {
    if (!text.trim()) return [];
    const q = parseQuantity(text);
    if (q === null) throw invalid(`qty:${lineId}`, "Enter a quantity, up to 3 decimals");
    return q > 0n ? [{ lineId, quantityMilli: q }] : [];
  });
  if (!wanted.length) {
    throw new ValidationError(
      data.kind === "RETURNED" ? "Enter what went back to the vendor." : "Enter what arrived.",
    );
  }
  return db.$transaction(async (tx) => {
    const order = await lockOrder(tx, id);
    requireStatus(order, "APPROVED");
    for (const w of wanted) {
      const line = order.lines.find((l) => l.id === w.lineId);
      if (!line) throw invalid(`qty:${w.lineId}`, "This line isn't on the order");
      const progress = progressOf(line, new Map());
      const left = data.kind === "RETURNED" ? stillOutMilli(progress) : toReceiveMilli(progress);
      if (w.quantityMilli > left) {
        throw invalid(
          `qty:${w.lineId}`,
          left
            ? `Only ${formatQuantity(left)} ${data.kind === "RETURNED" ? "is still on hire" : "is still to come"}`
            : data.kind === "RETURNED"
              ? "None of this is on hire"
              : "All of this has arrived",
        );
      }
    }
    const receipt = await tx.goodsReceipt.create({
      data: {
        purchaseOrderId: id,
        kind: data.kind,
        receivedOn: data.receivedOn!,
        locationId: data.locationId,
        reference: data.reference,
        notes: data.notes,
        createdById: actor.id,
        lines: {
          create: wanted.map((w) => ({
            lineId: w.lineId,
            quantity: formatQuantity(w.quantityMilli),
          })),
        },
      },
    });
    for (const w of wanted) {
      const amount = formatQuantity(w.quantityMilli);
      await tx.purchaseOrderLine.update({
        where: { id: w.lineId },
        data:
          data.kind === "RETURNED"
            ? { returnedQuantity: { increment: amount } }
            : { receivedQuantity: { increment: amount } },
      });
    }
    await recordAudit(tx, actor, {
      action: data.kind === "RETURNED" ? "purchase_order.returned" : "purchase_order.received",
      targetType: "purchase_order",
      targetId: id,
      legalEntityId: order.legalEntityId,
      metadata: {
        receiptId: receipt.id,
        receivedOn: isoDate(data.receivedOn),
        reference: data.reference,
        lines: wanted.map((w) => ({
          lineId: w.lineId,
          quantity: formatQuantity(w.quantityMilli),
        })),
      },
    });
    return receipt;
  });
}

/** Purchase orders waiting for this actor's approval, for the approvals inbox. */
export async function ordersAwaitingApproval(actor: Actor) {
  if (!can(actor, "procurement.approve")) return [];
  return db.purchaseOrder.findMany({
    where: { status: "SUBMITTED", ...entityFilter(actor, "procurement.approve") },
    select: {
      id: true,
      number: true,
      revision: true,
      submittedAt: true,
      subtotalMinor: true,
      currency: true,
      vendor: { select: { name: true } },
      legalEntity: { select: { code: true } },
    },
    orderBy: { submittedAt: "asc" },
  });
}
