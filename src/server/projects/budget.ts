import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor, type Caller } from "@/server/permissions/authorize";
import { LINE_CATEGORIES, type LineCategory } from "@/server/commercial/schemas";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { lineFigures, profitFigures, totalFigures, type LineFigures } from "@/lib/budget";
import { parseMoneyToMinor } from "@/lib/money";
import { parseQuantity, MILLI } from "@/lib/pricing";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { isPreApproval } from "./lifecycle";
import { assertChangeable, canSeeProjectCosts, loadProject, lockProject } from "./projects";
import { optionalDate, optionalId } from "./schemas";
import { approvedChangesByLine } from "./versions";
import { checkBudgetIntegrity, checkOperationsIntegrity } from "./integrity";

type Tx = Prisma.TransactionClient;
type Reader = Tx | typeof db;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

/** Typed money in the project's currency; `allowZero` (blank is zero) for budget lines. */
function money(
  currency: string,
  field: string,
  value: string | null | undefined,
  allowZero = false,
) {
  if (allowZero && !value?.trim()) return 0n;
  const minor = parseMoneyToMinor(value ?? "", currency);
  if (minor === null) throw invalid(field, "Enter an amount, e.g. 25000");
  if (minor < 0n || (!allowZero && minor === 0n)) {
    throw invalid(field, allowZero ? "Can't be negative" : "Enter an amount above zero");
  }
  return minor;
}

/** Budget figures for every line of a project, plus totals by category and overall. */
export async function budgetFigures(
  reader: Reader,
  project: { id: string; contractValueMinor: bigint },
) {
  const [lines, entries] = await Promise.all([
    reader.projectBudgetLine.findMany({
      where: { projectId: project.id },
      orderBy: { position: "asc" },
      include: { costCode: { select: { id: true, code: true, name: true } } },
    }),
    reader.projectCostEntry.findMany({ where: { projectId: project.id } }),
  ]);
  const changes = await approvedChangesByLine(reader, project.id);
  const rows = lines.map((line) => {
    const change = changes.get(line.id) ?? { costMinor: 0n, revenueMinor: 0n };
    return {
      line,
      figures: lineFigures({
        originalCostMinor: line.costMinor,
        originalRevenueMinor: line.revenueMinor,
        changeCostMinor: change.costMinor,
        changeRevenueMinor: change.revenueMinor,
        forecastOverrideMinor: line.forecastCostMinor,
        entries: entries
          .filter((e) => e.budgetLineId === line.id)
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            amountMinor: e.amountMinor,
            commitmentId: e.commitmentId,
            closed: e.closedAt !== null,
            voided: e.voidedAt !== null,
          })),
      }),
    };
  });
  const categories = (Object.keys(LINE_CATEGORIES) as LineCategory[])
    .map((category) => {
      const inCategory = rows.filter((r) => r.line.category === category);
      return {
        category,
        rows: inCategory,
        figures: totalFigures(inCategory.map((r) => r.figures)),
      };
    })
    .filter((c) => c.rows.length);
  const totals: LineFigures = totalFigures(rows.map((r) => r.figures));
  const revenueChanges = totals.revisedRevenueMinor - totals.originalRevenueMinor;
  return {
    rows,
    categories,
    totals,
    profit: profitFigures(project.contractValueMinor, revenueChanges, totals.forecastMinor),
  };
}

/** The budget screen: figures, lines and cost entries. Costs are sensitive. */
export async function getProjectBudget(actor: Actor, id: string) {
  const project = await loadProject(actor, id);
  if (!canSeeProjectCosts(actor, project.legalEntityId)) throw new ForbiddenError();
  const [figures, budgetProblems, operationsProblems, entries] = await Promise.all([
    budgetFigures(db, project),
    checkBudgetIntegrity(db, id),
    checkOperationsIntegrity(db, id),
    db.projectCostEntry.findMany({
      where: { projectId: id },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      include: {
        budgetLine: { select: { id: true, description: true } },
        createdBy: { select: { name: true } },
        commitment: { select: { id: true, description: true, reference: true } },
      },
    }),
  ]);
  return { project, ...figures, integrity: [...budgetProblems, ...operationsProblems], entries };
}

// ─── Draft budget lines (before approval) ────────────────────────────────────

const quantityText = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    if (!v?.trim()) return MILLI;
    const parsed = parseQuantity(v);
    if (parsed === null || parsed <= 0n) {
      ctx.addIssue({ code: "custom", message: "Enter a number above zero, e.g. 2 or 2.5" });
      return z.NEVER;
    }
    return parsed;
  });

const draftLineInput = z.object({
  lineId: optionalId,
  section: optionalText(100),
  category: z.enum(Object.keys(LINE_CATEGORIES) as [LineCategory, ...LineCategory[]], {
    message: "Choose a category",
  }),
  costCodeId: optionalId,
  description: requiredText(500),
  quantity: quantityText,
  days: quantityText,
  unitCode: optionalText(20),
  cost: z.string().nullish(),
  revenue: z.string().nullish(),
});
export type DraftLineInput = z.input<typeof draftLineInput>;

const milliToDecimal = (milli: bigint) =>
  new Prisma.Decimal(`${milli / MILLI}.${(milli % MILLI).toString().padStart(3, "0")}`);

async function checkCostCode(costCodeId: string | null, category: LineCategory) {
  if (!costCodeId) return;
  const code = await db.costCode.findUnique({ where: { id: costCodeId } });
  if (!code || code.status !== "ACTIVE") throw invalid("costCodeId", "Choose an active cost code");
  if (code.category !== category) {
    throw invalid("costCodeId", `This cost code is for ${LINE_CATEGORIES[code.category]} costs`);
  }
}

const LINE_FIELDS = [
  "section",
  "category",
  "costCodeId",
  "description",
  "quantity",
  "days",
  "unitCode",
  "costMinor",
  "revenueMinor",
] as const;

/**
 * Adds or changes a line of a draft project's budget. After approval the
 * budget is fixed and changes go through change orders.
 */
export async function saveDraftBudgetLine(actor: Actor, projectId: string, raw: DraftLineInput) {
  const project = await loadProject(actor, projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  const input = parseInput(draftLineInput, raw);
  const data = {
    section: input.section,
    category: input.category,
    costCodeId: input.costCodeId,
    description: input.description,
    quantity: milliToDecimal(input.quantity),
    days: milliToDecimal(input.days),
    unitCode: input.unitCode,
    costMinor: money(project.currency, "cost", input.cost, true),
    revenueMinor: money(project.currency, "revenue", input.revenue, true),
  };
  await checkCostCode(input.costCodeId, input.category);
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, projectId);
    if (!isPreApproval(current.status) || current.baselineLockedAt) {
      throw new ConflictError("The budget is approved. Change it with a change order.");
    }
    let line;
    let before = null;
    if (input.lineId) {
      before = await tx.projectBudgetLine.findUnique({ where: { id: input.lineId } });
      if (!before || before.projectId !== projectId) throw new NotFoundError();
      line = await tx.projectBudgetLine.update({ where: { id: before.id }, data });
    } else {
      const last = await tx.projectBudgetLine.aggregate({
        where: { projectId },
        _max: { position: true },
      });
      line = await tx.projectBudgetLine.create({
        data: { ...data, projectId, position: (last._max.position ?? -1) + 1 },
      });
    }
    await recordAudit(tx, actor, {
      action: before ? "project_budget_line.updated" : "project_budget_line.created",
      targetType: "project",
      targetId: projectId,
      legalEntityId: current.legalEntityId,
      changes: diffChanges(before, line, LINE_FIELDS),
      metadata: { lineId: line.id },
    });
    return line;
  });
}

export async function deleteDraftBudgetLine(actor: Actor, projectId: string, lineId: string) {
  const project = await loadProject(actor, projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, projectId);
    if (!isPreApproval(current.status) || current.baselineLockedAt) {
      throw new ConflictError("The budget is approved. Change it with a change order.");
    }
    const line = await tx.projectBudgetLine.findUnique({ where: { id: lineId } });
    if (!line || line.projectId !== projectId) throw new NotFoundError();
    await tx.projectBudgetLine.delete({ where: { id: lineId } });
    await recordAudit(tx, actor, {
      action: "project_budget_line.deleted",
      targetType: "project",
      targetId: projectId,
      legalEntityId: current.legalEntityId,
      changes: diffChanges(line, null, LINE_FIELDS),
      metadata: { lineId },
    });
  });
}

// ─── Classification and forecasts (any time the project is open) ────────────

async function loadLine(actor: Actor, lineId: string) {
  const line = await db.projectBudgetLine.findUnique({ where: { id: lineId } });
  if (!line) throw new NotFoundError();
  const project = await loadProject(actor, line.projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  return { line, project };
}

/** Files a line under a cost code. Doesn't change any amount, so it's allowed after approval. */
export async function setLineCostCode(actor: Actor, lineId: string, costCodeId: string | null) {
  const { line, project } = await loadLine(actor, lineId);
  await checkCostCode(costCodeId || null, line.category);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const after = await tx.projectBudgetLine.update({
      where: { id: lineId },
      data: { costCodeId: costCodeId || null },
    });
    await recordAudit(tx, actor, {
      action: "project_budget_line.cost_code_set",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(line, after, ["costCodeId"]),
      metadata: { lineId },
    });
    return after;
  });
}

const forecastInput = z.object({ forecast: z.string().nullish(), note: optionalText(500) });

/**
 * The project manager's estimate of a line's final cost. Blank goes back to
 * the calculated forecast. A note is required when an estimate is set.
 */
export async function setLineForecast(
  actor: Actor,
  lineId: string,
  raw: z.input<typeof forecastInput>,
) {
  const { line, project } = await loadLine(actor, lineId);
  const input = parseInput(forecastInput, raw);
  const forecastCostMinor = input.forecast?.trim()
    ? money(project.currency, "forecast", input.forecast, true)
    : null;
  if (forecastCostMinor !== null && !input.note)
    throw invalid("note", "Say what the estimate is based on");
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, project.id);
    assertChangeable(current);
    if (!current.baselineLockedAt) {
      throw new ConflictError("Forecasts start once the budget is approved.");
    }
    const after = await tx.projectBudgetLine.update({
      where: { id: lineId },
      data: { forecastCostMinor, forecastNote: forecastCostMinor === null ? null : input.note },
    });
    await recordAudit(tx, actor, {
      action: "project_budget_line.forecast_set",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(line, after, ["forecastCostMinor", "forecastNote"]),
      metadata: { lineId },
    });
    return after;
  });
}

// ─── Committed and actual costs ──────────────────────────────────────────────

const costEntryInput = z.object({
  budgetLineId: z.uuid("Choose a budget line"),
  kind: z.enum(["COMMITMENT", "ACTUAL"], { message: "Choose committed or actual" }),
  amount: z.string().nullish(),
  entryDate: optionalDate.refine((d) => d !== null, "Enter a date"),
  description: requiredText(500),
  supplier: optionalText(200),
  reference: optionalText(100),
  commitmentId: optionalId,
});
export type CostEntryInput = z.input<typeof costEntryInput>;

/**
 * Records a commitment (a booking or order not yet billed) or an actual cost
 * against a budget line. Entered by hand until purchase orders, vendor bills
 * and expenses arrive with Finance (Stage 4), which will post them here.
 */
export async function recordCostEntry(actor: Actor, projectId: string, raw: CostEntryInput) {
  const project = await loadProject(actor, projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  const input = parseInput(costEntryInput, raw);
  const amountMinor = money(project.currency, "amount", input.amount);
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, projectId);
    assertChangeable(current);
    if (!current.baselineLockedAt) {
      throw new ConflictError("Record costs once the project's budget is approved.");
    }
    const line = await tx.projectBudgetLine.findUnique({ where: { id: input.budgetLineId } });
    if (!line || line.projectId !== projectId)
      throw invalid("budgetLineId", "Choose a line of this budget");
    if (input.commitmentId) {
      if (input.kind !== "ACTUAL")
        throw invalid("commitmentId", "Only an actual cost draws down a commitment");
      const commitment = await tx.projectCostEntry.findUnique({
        where: { id: input.commitmentId },
      });
      if (
        !commitment ||
        commitment.kind !== "COMMITMENT" ||
        commitment.budgetLineId !== line.id ||
        commitment.voidedAt
      ) {
        throw invalid("commitmentId", "Choose a commitment on the same budget line");
      }
    }
    const entry = await tx.projectCostEntry.create({
      data: {
        projectId,
        budgetLineId: line.id,
        kind: input.kind,
        amountMinor,
        entryDate: input.entryDate!,
        description: input.description,
        supplier: input.supplier,
        reference: input.reference,
        commitmentId: input.commitmentId,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: input.kind === "ACTUAL" ? "project_cost.actual_recorded" : "project_cost.committed",
      targetType: "project",
      targetId: projectId,
      legalEntityId: current.legalEntityId,
      metadata: {
        entryId: entry.id,
        lineId: line.id,
        amountMinor: amountMinor.toString(),
        commitmentId: input.commitmentId,
      },
    });
    return entry;
  });
}

async function loadEntry(actor: Actor, entryId: string) {
  const entry = await db.projectCostEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new NotFoundError();
  const project = await loadProject(actor, entry.projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  return { entry, project };
}

/** Nothing more will be billed against this commitment: release what's left. */
export async function closeCommitment(actor: Actor, entryId: string) {
  const { entry, project } = await loadEntry(actor, entryId);
  if (entry.kind !== "COMMITMENT") throw new ConflictError("Only a commitment can be closed.");
  if (entry.sourceType) {
    throw new ConflictError("This commitment came from a booking or order. Close it there.");
  }
  if (entry.voidedAt || entry.closedAt)
    throw new ConflictError("This commitment is already closed or void.");
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const after = await tx.projectCostEntry.update({
      where: { id: entryId },
      data: { closedAt: new Date() },
    });
    await recordAudit(tx, actor, {
      action: "project_cost.commitment_closed",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { entryId },
    });
    return after;
  });
}

/** Cancels a mistaken entry. It stays on record, struck out, with the reason. */
export async function voidCostEntry(
  actor: Actor,
  entryId: string,
  raw: { reason?: string | null },
) {
  const { entry, project } = await loadEntry(actor, entryId);
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  if (entry.voidedAt) throw new ConflictError("This entry is already void.");
  if (entry.sourceType) {
    throw new ConflictError("This cost came from a finance document. Void the document instead.");
  }
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const live = await tx.projectCostEntry.count({
      where: { commitmentId: entryId, voidedAt: null },
    });
    if (live) throw new ConflictError("Void the actual costs drawn against this commitment first.");
    const after = await tx.projectCostEntry.update({
      where: { id: entryId },
      data: { voidedAt: new Date(), voidReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "project_cost.voided",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { entryId, reason, amountMinor: entry.amountMinor.toString(), kind: entry.kind },
    });
    return after;
  });
}

// ─── Costs posted by documents ───────────────────────────────────────────────

/** Documents that post cost entries; such entries are changed only through them. */
export type CostSource =
  | "vendor_bill_line"
  | "expense_claim_line"
  | "crew_assignment"
  | "purchase_order_line"
  | "travel_booking";

type DocumentCostInput = {
  projectId: string;
  budgetLineId: string;
  amountMinor: bigint;
  entryDate: Date;
  description: string;
  supplier: string;
  reference: string;
  sourceType: CostSource;
  sourceId: string;
  createdById: string;
};

async function documentEntry(
  tx: Tx,
  caller: Caller,
  kind: "ACTUAL" | "COMMITMENT",
  input: DocumentCostInput & { commitmentId?: string | null },
) {
  const project = await lockProject(tx, input.projectId);
  assertChangeable(project);
  if (!project.baselineLockedAt) {
    throw new ConflictError(
      `Project ${project.number}'s budget isn't approved yet, so it can't take costs.`,
    );
  }
  const line = await tx.projectBudgetLine.findUnique({ where: { id: input.budgetLineId } });
  if (!line || line.projectId !== project.id) {
    throw new ValidationError(`Choose a budget line of project ${project.number}.`);
  }
  if (input.commitmentId) {
    const commitment = await tx.projectCostEntry.findUnique({ where: { id: input.commitmentId } });
    if (
      !commitment ||
      commitment.kind !== "COMMITMENT" ||
      commitment.budgetLineId !== line.id ||
      commitment.voidedAt
    ) {
      throw new ValidationError(
        `The commitment this cost draws down isn't open on that budget line of ${project.number}.`,
      );
    }
  }
  const entry = await tx.projectCostEntry.create({
    data: {
      projectId: project.id,
      budgetLineId: line.id,
      kind,
      amountMinor: input.amountMinor,
      entryDate: input.entryDate,
      description: input.description,
      supplier: input.supplier,
      reference: input.reference,
      commitmentId: input.commitmentId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdById: input.createdById,
    },
  });
  await recordAudit(tx, caller, {
    action: kind === "ACTUAL" ? "project_cost.actual_recorded" : "project_cost.committed",
    targetType: "project",
    targetId: project.id,
    legalEntityId: project.legalEntityId,
    metadata: {
      entryId: entry.id,
      lineId: line.id,
      amountMinor: input.amountMinor.toString(),
      source: input.sourceType,
      reference: input.reference,
      ...(input.commitmentId ? { commitmentId: input.commitmentId } : {}),
    },
  });
  return entry;
}

/**
 * Records an actual cost from a document (a vendor bill line, an expense
 * claim) inside the document's transaction. The amount is in the project's
 * currency. When the document bills a commitment, the cost draws it down so
 * it isn't counted twice. Voided only through the document.
 */
export async function postDocumentCost(
  tx: Tx,
  caller: Caller,
  input: DocumentCostInput & { commitmentId?: string | null },
) {
  return documentEntry(tx, caller, "ACTUAL", input);
}

/** Records a commitment from a booking or a purchase order line, in its transaction. */
export async function postDocumentCommitment(tx: Tx, caller: Caller, input: DocumentCostInput) {
  return documentEntry(tx, caller, "COMMITMENT", input);
}

/**
 * Ends a document's commitment: voided when nothing has been billed against
 * it, otherwise closed so what wasn't billed is released.
 */
export async function endDocumentCommitment(
  tx: Tx,
  caller: Caller,
  entryId: string,
  reason: string,
) {
  const entry = await tx.projectCostEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (entry.voidedAt || entry.closedAt) return entry;
  const live = await tx.projectCostEntry.count({
    where: { commitmentId: entryId, voidedAt: null },
  });
  if (!live) return voidDocumentCost(tx, caller, entryId, reason);
  const project = await lockProject(tx, entry.projectId);
  const after = await tx.projectCostEntry.update({
    where: { id: entryId },
    data: { closedAt: new Date() },
  });
  await recordAudit(tx, caller, {
    action: "project_cost.commitment_closed",
    targetType: "project",
    targetId: project.id,
    legalEntityId: project.legalEntityId,
    metadata: { entryId, reason },
  });
  return after;
}

/**
 * Replaces a document's commitment when an approved amendment changes it (a
 * purchase order line's price or quantity). Cost entries are append-only, so
 * the old one is ended and a new one posted for what is still to be billed:
 * the new amount less what was already billed against the old one. Returns
 * the new commitment, or null when nothing is left to commit.
 */
export async function replaceDocumentCommitment(
  tx: Tx,
  caller: Caller,
  entryId: string,
  input: DocumentCostInput,
) {
  const old = await tx.projectCostEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (old.amountMinor === input.amountMinor && !old.voidedAt && !old.closedAt) return old;
  const drawn = await tx.projectCostEntry.aggregate({
    where: { commitmentId: entryId, kind: "ACTUAL", voidedAt: null },
    _sum: { amountMinor: true },
  });
  await endDocumentCommitment(tx, caller, entryId, `Replaced: ${input.reference}`);
  const left = input.amountMinor - (drawn._sum.amountMinor ?? 0n);
  if (left <= 0n) return null;
  return postDocumentCommitment(tx, caller, { ...input, amountMinor: left });
}

/** Voids costs a document posted, when the document is voided. */
export async function voidDocumentCost(tx: Tx, caller: Caller, entryId: string, reason: string) {
  const entry = await tx.projectCostEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (entry.voidedAt) return entry;
  const project = await lockProject(tx, entry.projectId);
  const after = await tx.projectCostEntry.update({
    where: { id: entryId },
    data: { voidedAt: new Date(), voidReason: reason },
  });
  await recordAudit(tx, caller, {
    action: "project_cost.voided",
    targetType: "project",
    targetId: project.id,
    legalEntityId: project.legalEntityId,
    metadata: { entryId, reason, amountMinor: entry.amountMinor.toString(), kind: entry.kind },
  });
  return after;
}
