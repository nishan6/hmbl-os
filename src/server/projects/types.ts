import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, authorizeEverywhere, type Actor } from "@/server/permissions/authorize";
import { NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { projectTypeInput, type ProjectTypeInput, type RevenueModel } from "./schemas";

/*
 * Project types are group-wide configuration, like the other master data:
 * reading needs `projects.view`, changing needs `projects.configure` for
 * every entity.
 */

/**
 * DEFAULT PROJECT TYPES — labelled starting points from the kinds of work the
 * spec describes (§2), not approved policy. Created once if missing by
 * `pnpm db:seed` and `pnpm user:create`.
 */
export const DEFAULT_PROJECT_TYPES: {
  code: string;
  name: string;
  defaultRevenueModel: RevenueModel;
}[] = [
  { code: "LIVE", name: "Live event", defaultRevenueModel: "ITEMISED" },
  { code: "BROADCAST", name: "Broadcast production", defaultRevenueModel: "FIXED_FEE" },
  { code: "RENTAL", name: "Equipment rental", defaultRevenueModel: "RENTAL" },
  { code: "TOUR", name: "Touring", defaultRevenueModel: "ITEMISED" },
  { code: "RETAINER", name: "Retainer", defaultRevenueModel: "RETAINER" },
  { code: "INTERNAL", name: "Internal project", defaultRevenueModel: "INTERNAL" },
];

export async function ensureProjectTypeDefaults(client: PrismaClient): Promise<string[]> {
  const created: string[] = [];
  for (const type of DEFAULT_PROJECT_TYPES) {
    if (await client.projectType.findUnique({ where: { code: type.code } })) continue;
    await client.projectType.create({ data: type });
    created.push(`project type ${type.code}`);
  }
  return created;
}

const FIELDS = ["code", "name", "description", "defaultRevenueModel", "status"] as const;

export async function listProjectTypes(actor: Actor, options: { includeArchived?: boolean } = {}) {
  authorize(actor, "projects.view");
  return db.projectType.findMany({
    where: options.includeArchived ? {} : { status: "ACTIVE" },
    orderBy: { name: "asc" },
  });
}

export async function createProjectType(actor: Actor, input: ProjectTypeInput) {
  authorizeEverywhere(actor, "projects.configure");
  const data = parseInput(projectTypeInput, input);
  return withUniqueConflict(`A project type with code ${data.code} already exists.`, () =>
    db.$transaction(async (tx) => {
      const type = await tx.projectType.create({ data });
      await recordAudit(tx, actor, {
        action: "project_type.created",
        targetType: "project_type",
        targetId: type.id,
        changes: diffChanges(null, type, FIELDS),
      });
      return type;
    }),
  );
}

export async function setProjectTypeArchived(actor: Actor, id: string, archived: boolean) {
  authorizeEverywhere(actor, "projects.configure");
  return db.$transaction(async (tx) => {
    const type = await tx.projectType.findUnique({ where: { id } });
    if (!type) throw new NotFoundError();
    const status = archived ? "ARCHIVED" : "ACTIVE";
    if (type.status === status) return type;
    const after = await tx.projectType.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "project_type.archived" : "project_type.restored",
      targetType: "project_type",
      targetId: id,
      changes: diffChanges(type, after, ["status"]),
    });
    return after;
  });
}
