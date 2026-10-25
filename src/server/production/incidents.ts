import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { IncidentCategory, IncidentSeverity } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { can, type Actor } from "@/server/permissions/authorize";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { loadShow, lockShow } from "./access";

/*
 * Incident records (spec §16): anything that went wrong at a show, from a
 * blown fuse to an injury. Anyone on the show who can post reports one;
 * whoever plans the show resolves it. Who was involved is personal
 * information: only planners and the person who reported it see it. Serious
 * incidents tell the project manager and planners at once. Incidents are
 * never deleted, and open ones hold the project's final-report closeout.
 */

type Tx = Prisma.TransactionClient;
type Incident = Prisma.ShowIncidentGetPayload<object>;

export const INCIDENT_CATEGORIES: Record<IncidentCategory, string> = {
  SAFETY: "Safety",
  INJURY: "Injury or illness",
  TECHNICAL: "Technical",
  EQUIPMENT: "Equipment",
  CREW: "Crew",
  VENUE: "Venue",
  SECURITY: "Security",
  OTHER: "Other",
};

export const INCIDENT_SEVERITIES: Record<IncidentSeverity, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

const FIELDS = [
  "occurredAt",
  "category",
  "severity",
  "title",
  "description",
  "location",
  "peopleInvolved",
  "actionTaken",
] as const;

const enumOf = <T extends string>(values: Record<T, string>, message: string) =>
  z.enum(Object.keys(values) as [T, ...T[]], { message });

const incidentInput = z.object({
  occurredAt: z.coerce.date({ message: "Enter when it happened" }),
  category: enumOf(INCIDENT_CATEGORIES, "Choose what kind of incident"),
  severity: enumOf(INCIDENT_SEVERITIES, "Choose how serious it is"),
  title: requiredText(200),
  description: requiredText(4000),
  location: optionalText(200),
  peopleInvolved: optionalText(1000),
  actionTaken: optionalText(4000),
});
export type IncidentInput = z.input<typeof incidentInput>;

function checkTime(occurredAt: Date) {
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
    throw new ValidationError("Check the highlighted fields.", {
      occurredAt: ["It can't have happened in the future"],
    });
  }
}

function canSeePeople(actor: Actor, incident: { reportedById: string }, legalEntityId: string) {
  return incident.reportedById === actor.id || can(actor, "production.edit", { legalEntityId });
}

/** The incident as the actor may see it: who was involved only for planners and the reporter. */
export function redactIncident<T extends Pick<Incident, "reportedById" | "peopleInvolved">>(
  actor: Actor,
  incident: T,
  legalEntityId: string,
): T & { peopleHidden: boolean } {
  const see = canSeePeople(actor, incident, legalEntityId);
  return {
    ...incident,
    peopleInvolved: see ? incident.peopleInvolved : null,
    peopleHidden: !see && Boolean(incident.peopleInvolved),
  };
}

export async function listIncidents(actor: Actor, projectId: string) {
  const show = await loadShow(actor, projectId);
  const rows = await db.showIncident.findMany({
    where: { projectId },
    orderBy: [{ status: "asc" }, { occurredAt: "desc" }],
  });
  const people = await db.user.findMany({
    where: {
      id: {
        in: [...new Set(rows.flatMap((r) => [r.reportedById, r.resolvedById]))].filter(
          Boolean,
        ) as string[],
      },
    },
    select: { id: true, name: true },
  });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    ...redactIncident(actor, r, show.legalEntityId),
    reportedBy: names.get(r.reportedById) ?? "Unknown",
    resolvedBy: r.resolvedById ? (names.get(r.resolvedById) ?? "Unknown") : null,
    mayEdit:
      r.status === "OPEN" &&
      (r.reportedById === actor.id ||
        can(actor, "production.edit", { legalEntityId: show.legalEntityId })),
  }));
}

/** Reports an incident. `tx` lets an offline change run in its sync transaction. */
export async function reportIncident(actor: Actor, projectId: string, raw: IncidentInput, tx?: Tx) {
  const input = parseInput(incidentInput, raw);
  checkTime(input.occurredAt);
  const run = async (t: Tx) => {
    const project = await lockShow(t, actor, projectId, "production.create");
    const incident = await t.showIncident.create({
      data: { ...input, projectId, reportedById: actor.id },
    });
    await recordAudit(t, actor, {
      action: "production.incident_reported",
      targetType: "show_incident",
      targetId: incident.id,
      legalEntityId: project.legalEntityId,
      // Who was involved stays out of the audit log's values.
      changes: diffChanges(
        null,
        { ...incident, peopleInvolved: incident.peopleInvolved ? "[recorded]" : null },
        FIELDS,
      ),
      metadata: {
        projectId,
        severity: incident.severity,
        category: incident.category,
        title: incident.title,
      },
    });
    return incident;
  };
  return tx ? run(tx) : db.$transaction(run);
}

async function loadIncident(actor: Actor, id: string) {
  const incident = await db.showIncident.findUnique({ where: { id } });
  if (!incident) throw new NotFoundError();
  const show = await loadShow(actor, incident.projectId);
  return { incident, show };
}

/** Changes an open incident: its reporter or a planner. */
export async function updateIncident(actor: Actor, id: string, raw: IncidentInput) {
  const input = parseInput(incidentInput, raw);
  checkTime(input.occurredAt);
  const { incident, show } = await loadIncident(actor, id);
  const planner = can(actor, "production.edit", { legalEntityId: show.legalEntityId });
  if (incident.reportedById !== actor.id && !planner) throw new ForbiddenError();
  return db.$transaction(async (tx) => {
    await lockShow(tx, actor, incident.projectId, "production.create");
    const before = await tx.showIncident.findUniqueOrThrow({ where: { id } });
    if (before.status !== "OPEN")
      throw new ConflictError("This incident is resolved, so it can't be changed.");
    const after = await tx.showIncident.update({ where: { id }, data: input });
    const changes = diffChanges(before, after, FIELDS);
    if (changes?.peopleInvolved) changes.peopleInvolved = { from: "[recorded]", to: "[recorded]" };
    await recordAudit(tx, actor, {
      action: "production.incident_updated",
      targetType: "show_incident",
      targetId: id,
      legalEntityId: show.legalEntityId,
      changes,
      metadata: { projectId: incident.projectId, title: after.title },
    });
    return after;
  });
}

const resolveInput = z.object({ resolution: requiredText(2000) });

export async function resolveIncident(actor: Actor, id: string, raw: z.input<typeof resolveInput>) {
  const input = parseInput(resolveInput, raw);
  const { incident, show } = await loadIncident(actor, id);
  return db.$transaction(async (tx) => {
    await lockShow(tx, actor, incident.projectId, "production.edit");
    const before = await tx.showIncident.findUniqueOrThrow({ where: { id } });
    if (before.status !== "OPEN") throw new ConflictError("This incident is already resolved.");
    const after = await tx.showIncident.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolution: input.resolution,
        resolvedAt: new Date(),
        resolvedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "production.incident_resolved",
      targetType: "show_incident",
      targetId: id,
      legalEntityId: show.legalEntityId,
      metadata: { projectId: incident.projectId, title: after.title, resolution: input.resolution },
    });
    return after;
  });
}
