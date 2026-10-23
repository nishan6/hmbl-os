import "server-only";
import { db } from "@/server/db";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { NotFoundError } from "@/lib/errors";

/**
 * Budget cost and margin are for people who run the project or price it:
 * `projects.edit`, `projects.view_sensitive`, or anyone who sees quote costs.
 */
export function canSeeProjectCosts(actor: Actor, legalEntityId: string) {
  const scope = { legalEntityId };
  return (
    can(actor, "projects.edit", scope) ||
    can(actor, "projects.view_sensitive", scope) ||
    can(actor, "commercial.edit", scope) ||
    can(actor, "commercial.view_sensitive", scope)
  );
}

const projectInclude = {
  legalEntity: { select: { id: true, code: true, legalName: true, timezone: true } },
  client: { select: { id: true, name: true } },
} as const;

export type ProjectListOptions = {
  legalEntityId?: string | null;
  clientId?: string;
  opportunityId?: string;
  search?: string;
};

export async function listProjects(actor: Actor, options: ProjectListOptions = {}) {
  authorize(actor, "projects.view");
  const search = options.search?.trim();
  return db.project.findMany({
    where: {
      ...entityFilter(actor, "projects.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.clientId ? { clientId: options.clientId } : {}),
      ...(options.opportunityId ? { opportunityId: options.opportunityId } : {}),
      ...(search
        ? {
            OR: [
              { number: { contains: search, mode: "insensitive" as const } },
              { name: { contains: search, mode: "insensitive" as const } },
              { client: { name: { contains: search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    },
    include: projectInclude,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

/** A project with its budget and milestones. Cost figures are removed unless the actor may see them. */
export async function getProject(actor: Actor, id: string) {
  const project = await db.project.findUnique({
    where: { id },
    include: {
      ...projectInclude,
      opportunity: { select: { id: true, title: true } },
      quote: { select: { id: true, number: true } },
      sourceQuoteVersion: {
        select: {
          version: true,
          acceptedOn: true,
          acceptedByName: true,
          acceptanceMethod: true,
        },
      },
      createdBy: { select: { name: true } },
      budgetLines: { orderBy: { position: "asc" } },
      milestones: { orderBy: { position: "asc" } },
    },
  });
  if (!project || !can(actor, "projects.view", { legalEntityId: project.legalEntityId })) {
    throw new NotFoundError();
  }
  const showCosts = canSeeProjectCosts(actor, project.legalEntityId);
  return {
    ...project,
    showCosts,
    budgetCostMinor: showCosts ? project.budgetCostMinor : null,
    budgetLines: project.budgetLines.map((line) => ({
      ...line,
      costMinor: showCosts ? line.costMinor : null,
    })),
  };
}

/** The project made from a quote, if any, for the quote page. */
export async function projectForQuote(actor: Actor, quoteId: string) {
  return db.project.findFirst({
    where: { quoteId, ...entityFilter(actor, "projects.view") },
    select: { id: true, number: true, sourceQuoteVersionId: true },
  });
}
