import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, authorizeEverywhere, type Actor } from "@/server/permissions/authorize";
import { LINE_CATEGORIES, type LineCategory } from "@/server/commercial/schemas";
import { NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { codeSchema, optionalText, requiredText } from "@/lib/validation";

/*
 * Budget categories are the quote line categories, so a quote's lines land
 * in the right category without mapping. Cost codes sit under them and are
 * configurable group-wide master data (`projects.configure` everywhere).
 */

/**
 * DEFAULT COST CODES — labelled starting points, not HMBL's chart of
 * accounts. Created once if missing by `pnpm db:seed` and `pnpm user:create`.
 */
export const DEFAULT_COST_CODES: { code: string; name: string; category: LineCategory }[] = [
  { code: "CR-STAFF", name: "Staff crew", category: "CREW" },
  { code: "CR-FREELANCE", name: "Freelance crew", category: "CREW" },
  { code: "EQ-OWNED", name: "Owned equipment (internal hire)", category: "EQUIPMENT" },
  { code: "RN-EXTERNAL", name: "External rental", category: "RENTAL" },
  { code: "SV-SUBCONTRACT", name: "Subcontracted services", category: "SERVICES" },
  { code: "PR-SET", name: "Set, staging and fabrication", category: "PRODUCTION" },
  { code: "PR-CONSUMABLES", name: "Consumables", category: "PRODUCTION" },
  { code: "TR-FLIGHTS", name: "Flights and trains", category: "TRAVEL" },
  { code: "TR-HOTELS", name: "Hotels", category: "TRAVEL" },
  { code: "TR-PERDIEM", name: "Per diems", category: "TRAVEL" },
  { code: "LG-FREIGHT", name: "Freight and trucking", category: "LOGISTICS" },
  { code: "FE-PERMITS", name: "Permits, licences and fees", category: "FEES" },
  { code: "OT-MISC", name: "Other costs", category: "OTHER" },
];

export async function ensureCostCodeDefaults(client: PrismaClient): Promise<string[]> {
  const created: string[] = [];
  for (const code of DEFAULT_COST_CODES) {
    if (await client.costCode.findUnique({ where: { code: code.code } })) continue;
    await client.costCode.create({ data: code });
    created.push(`cost code ${code.code}`);
  }
  return created;
}

export const costCodeInput = z.object({
  code: codeSchema,
  name: requiredText(80),
  category: z.enum(Object.keys(LINE_CATEGORIES) as [LineCategory, ...LineCategory[]], {
    message: "Choose a category",
  }),
  description: optionalText(500),
});
export type CostCodeInput = z.input<typeof costCodeInput>;

const FIELDS = ["code", "name", "category", "description", "status"] as const;

export async function listCostCodes(actor: Actor, options: { includeArchived?: boolean } = {}) {
  authorize(actor, "projects.view");
  return db.costCode.findMany({
    where: options.includeArchived ? {} : { status: "ACTIVE" },
    orderBy: [{ category: "asc" }, { code: "asc" }],
  });
}

export async function createCostCode(actor: Actor, input: CostCodeInput) {
  authorizeEverywhere(actor, "projects.configure");
  const data = parseInput(costCodeInput, input);
  return withUniqueConflict(`A cost code ${data.code} already exists.`, () =>
    db.$transaction(async (tx) => {
      const code = await tx.costCode.create({ data });
      await recordAudit(tx, actor, {
        action: "cost_code.created",
        targetType: "cost_code",
        targetId: code.id,
        changes: diffChanges(null, code, FIELDS),
      });
      return code;
    }),
  );
}

export async function setCostCodeArchived(actor: Actor, id: string, archived: boolean) {
  authorizeEverywhere(actor, "projects.configure");
  return db.$transaction(async (tx) => {
    const code = await tx.costCode.findUnique({ where: { id } });
    if (!code) throw new NotFoundError();
    const status = archived ? "ARCHIVED" : "ACTIVE";
    if (code.status === status) return code;
    const after = await tx.costCode.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "cost_code.archived" : "cost_code.restored",
      targetType: "cost_code",
      targetId: id,
      changes: diffChanges(code, after, ["status"]),
    });
    return after;
  });
}
