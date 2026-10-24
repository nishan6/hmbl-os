import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { can, type Actor } from "@/server/permissions/authorize";
import { assertChangeable, lockProject } from "@/server/projects/projects";
import { isLocked } from "@/server/projects/lifecycle";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

/*
 * Who can do what on a show (docs/production.md):
 *
 *   production.view    open the show day of projects in the entity
 *   production.create  post status updates and notes (the crew at the venue)
 *   production.edit    run of show, call sheets, editing and archiving notes
 *
 * The show day is its own permission so venue crew can see what they need
 * without the rest of the project. Costs never appear on it.
 */

type Tx = Prisma.TransactionClient;

export type ShowProject = Awaited<ReturnType<typeof loadShow>>;

/** A project the actor may open the show day of; anything else is not found. */
export async function loadShow(actor: Actor, projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      legalEntity: { select: { id: true, code: true, timezone: true } },
      client: { select: { name: true } },
      projectManager: { select: { name: true, email: true } },
      producer: { select: { name: true, email: true } },
    },
  });
  if (!project || !can(actor, "production.view", { legalEntityId: project.legalEntityId })) {
    throw new NotFoundError();
  }
  return project;
}

export function showAbilities(
  actor: Actor,
  project: { legalEntityId: string; status: Parameters<typeof isLocked>[0] },
) {
  const scope = { legalEntityId: project.legalEntityId };
  const open = !isLocked(project.status);
  return {
    post: open && can(actor, "production.create", scope),
    plan: open && can(actor, "production.edit", scope),
  };
}

/** Locks the project for a show-day change and checks the actor may make it. */
export async function lockShow(
  tx: Tx,
  actor: Actor,
  projectId: string,
  permission: "production.create" | "production.edit",
) {
  const project = await lockProject(tx, projectId);
  if (!can(actor, "production.view", { legalEntityId: project.legalEntityId })) {
    throw new NotFoundError();
  }
  if (!can(actor, permission, { legalEntityId: project.legalEntityId })) {
    throw new ForbiddenError();
  }
  assertChangeable(project);
  return project;
}
