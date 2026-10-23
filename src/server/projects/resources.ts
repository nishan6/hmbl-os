import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { planAgainstBudget, plannedCostMinor, RESOURCE_LINE_CATEGORIES } from "@/lib/resources";
import { budgetFigures } from "./budget";
import { assertChangeable, canSeeProjectCosts, loadProject, lockProject } from "./projects";
import { optionalDate, optionalId, requiredDate } from "./schemas";

/*
 * Crew and equipment planning (spec §10, "Staffing plan", "Equipment plan"):
 * what the project needs, for which days, and which budget line pays for it.
 * The priced plan is checked against the line's revised budget. Named people
 * and specific assets are assigned in Stage 5.
 */

export const RESOURCE_KINDS = { CREW: "Crew", EQUIPMENT: "Equipment" } as const;
export type ResourceKind = keyof typeof RESOURCE_KINDS;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const requirementInput = z
  .object({
    kind: z.enum(Object.keys(RESOURCE_KINDS) as [ResourceKind, ...ResourceKind[]], {
      message: "Choose crew or equipment",
    }),
    name: requiredText(200),
    quantity: z.union([z.number(), z.string()]).transform((v, ctx) => {
      const n = Number(v);
      if (v === "" || !Number.isInteger(n) || n < 1 || n > 10_000) {
        ctx.addIssue({ code: "custom", message: "Enter a whole number from 1" });
        return z.NEVER;
      }
      return n;
    }),
    startDate: requiredDate,
    endDate: optionalDate,
    budgetLineId: optionalId,
    dayRate: z.string().nullish(),
    notes: optionalText(2000),
  })
  .transform(({ startDate, endDate, ...v }) => ({
    ...v,
    startDate: startDate!,
    endDate: endDate ?? startDate!,
  }))
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End on or after the start" });
    }
  });
export type RequirementInput = z.input<typeof requirementInput>;

const FIELDS = [
  "kind",
  "name",
  "quantity",
  "startDate",
  "endDate",
  "budgetLineId",
  "dayRateMinor",
  "notes",
] as const;

/** The crew and equipment plan. Rates and the budget check need cost visibility. */
export async function getResourcePlan(actor: Actor, projectId: string) {
  const project = await loadProject(actor, projectId);
  const showCosts = canSeeProjectCosts(actor, project.legalEntityId);
  const [requirements, lines] = await Promise.all([
    db.projectResourceRequirement.findMany({
      where: { projectId },
      orderBy: [{ kind: "asc" }, { startDate: "asc" }, { createdAt: "asc" }],
      include: { budgetLine: { select: { id: true, description: true, category: true } } },
    }),
    db.projectBudgetLine.findMany({
      where: { projectId },
      orderBy: { position: "asc" },
      select: { id: true, description: true, category: true },
    }),
  ]);
  let checks: ReturnType<typeof planAgainstBudget> = [];
  if (showCosts) {
    const figures = await budgetFigures(db, project);
    checks = planAgainstBudget(
      requirements,
      new Map(figures.rows.map((r) => [r.line.id, r.figures.revisedMinor])),
    );
  }
  return {
    project,
    showCosts,
    lines,
    checks,
    requirements: requirements.map((r) => ({
      ...r,
      dayRateMinor: showCosts ? r.dayRateMinor : null,
      plannedMinor: showCosts ? plannedCostMinor(r) : null,
    })),
  };
}

/** Adds a requirement, or changes one when `requirementId` is given. */
export async function saveRequirement(
  actor: Actor,
  projectId: string,
  raw: RequirementInput & { requirementId?: string | null },
) {
  const project = await loadProject(actor, projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  const showCosts = canSeeProjectCosts(actor, project.legalEntityId);
  const { dayRate, ...input } = parseInput(requirementInput, raw);
  let dayRateMinor: bigint | null = null;
  if (dayRate?.trim()) {
    dayRateMinor = parseMoneyToMinor(dayRate, project.currency);
    if (dayRateMinor === null || dayRateMinor < 0n) {
      throw invalid("dayRate", "Enter a day rate, e.g. 3500");
    }
  }
  if (input.budgetLineId) {
    const line = await db.projectBudgetLine.findUnique({ where: { id: input.budgetLineId } });
    const allowed: readonly string[] = RESOURCE_LINE_CATEGORIES[input.kind];
    if (!line || line.projectId !== projectId) {
      throw invalid("budgetLineId", "Choose a line of this budget");
    }
    if (!allowed.includes(line.category)) {
      throw invalid(
        "budgetLineId",
        input.kind === "CREW" ? "Choose a crew line" : "Choose an equipment or rental line",
      );
    }
  }
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, projectId));
    if (raw.requirementId) {
      const before = await tx.projectResourceRequirement.findUnique({
        where: { id: raw.requirementId },
      });
      if (!before || before.projectId !== projectId) throw new NotFoundError();
      // Someone who can't see rates keeps the rate that is there.
      const data = { ...input, dayRateMinor: showCosts ? dayRateMinor : before.dayRateMinor };
      const after = await tx.projectResourceRequirement.update({ where: { id: before.id }, data });
      const changes = diffChanges(before, after, FIELDS);
      if (changes) {
        await recordAudit(tx, actor, {
          action: "resource.updated",
          targetType: "project",
          targetId: projectId,
          legalEntityId: project.legalEntityId,
          changes,
          metadata: { requirementId: after.id },
        });
      }
      return after;
    }
    const created = await tx.projectResourceRequirement.create({
      data: {
        ...input,
        dayRateMinor: showCosts ? dayRateMinor : null,
        projectId,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "resource.created",
      targetType: "project",
      targetId: projectId,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(null, created, FIELDS),
      metadata: { requirementId: created.id },
    });
    return created;
  });
}

export async function deleteRequirement(actor: Actor, id: string) {
  const requirement = await db.projectResourceRequirement.findUnique({ where: { id } });
  if (!requirement) throw new NotFoundError();
  const project = await loadProject(actor, requirement.projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  await db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    await tx.projectResourceRequirement.delete({ where: { id } });
    await recordAudit(tx, actor, {
      action: "resource.deleted",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      changes: diffChanges(requirement, null, FIELDS),
      metadata: { requirementId: id },
    });
  });
}
