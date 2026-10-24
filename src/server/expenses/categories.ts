import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorizeEverywhere, type Actor } from "@/server/permissions/authorize";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { requiredText } from "@/lib/validation";

/*
 * Expense categories are group-wide configuration: anyone claiming sees
 * them, and Finance (`finance.configure` everywhere) changes them.
 */

/**
 * DEFAULT EXPENSE CATEGORIES — labelled starting points for a live production
 * company, not approved policy (docs/decisions.md, "Expense limits"). Limits
 * are per line, in rupees.
 */
export const DEFAULT_EXPENSE_CATEGORIES: {
  key: string;
  name: string;
  accountCode: string;
  limitMinor: bigint | null;
  receiptRequired: boolean;
}[] = [
  {
    key: "travel",
    name: "Travel (flights, trains, buses)",
    accountCode: "5030",
    limitMinor: null,
    receiptRequired: true,
  },
  {
    key: "local_conveyance",
    name: "Local conveyance (taxi, auto, fuel)",
    accountCode: "5030",
    limitMinor: 2_000_00n,
    receiptRequired: false,
  },
  {
    key: "accommodation",
    name: "Accommodation",
    accountCode: "5040",
    limitMinor: 8_000_00n,
    receiptRequired: true,
  },
  {
    key: "meals",
    name: "Meals",
    accountCode: "5040",
    limitMinor: 1_500_00n,
    receiptRequired: true,
  },
  {
    key: "freight",
    name: "Courier and freight",
    accountCode: "5050",
    limitMinor: null,
    receiptRequired: true,
  },
  {
    key: "venue_fees",
    name: "Permits, parking and venue fees",
    accountCode: "5060",
    limitMinor: null,
    receiptRequired: true,
  },
  {
    key: "site_purchases",
    name: "Site purchases and consumables",
    accountCode: "5090",
    limitMinor: 10_000_00n,
    receiptRequired: true,
  },
  {
    key: "office",
    name: "Office expenses",
    accountCode: "6070",
    limitMinor: 5_000_00n,
    receiptRequired: true,
  },
];

export async function ensureExpenseCategoryDefaults(client: PrismaClient | typeof db) {
  const created: string[] = [];
  for (const [position, c] of DEFAULT_EXPENSE_CATEGORIES.entries()) {
    if (await client.expenseCategory.findUnique({ where: { key: c.key } })) continue;
    await client.expenseCategory.create({
      data: { ...c, limitCurrency: c.limitMinor === null ? null : "INR", position },
    });
    created.push(`expense category ${c.key}`);
  }
  return created;
}

/** Categories for claim forms and settings; the defaults are added the first time. */
export async function listExpenseCategories(options: { includeArchived?: boolean } = {}) {
  await ensureExpenseCategoryDefaults(db);
  return db.expenseCategory.findMany({
    where: options.includeArchived ? {} : { status: "ACTIVE" },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
}

const categoryInput = z.object({
  name: requiredText(120),
  accountCode: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/, "Enter an account code, such as 5030"),
  limit: z.string().trim().nullish(),
  receiptRequired: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true" || v === "on"),
  archived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "true" || v === "on"),
});
export type ExpenseCategoryInput = z.input<typeof categoryInput>;

const FIELDS = ["name", "accountCode", "limitMinor", "receiptRequired", "status"] as const;

export async function updateExpenseCategory(actor: Actor, id: string, raw: ExpenseCategoryInput) {
  authorizeEverywhere(actor, "finance.configure");
  const before = await db.expenseCategory.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  const data = parseInput(categoryInput, raw);
  let limitMinor: bigint | null = null;
  if (data.limit) {
    limitMinor = parseMoneyToMinor(data.limit, "INR");
    if (limitMinor === null || limitMinor <= 0n) {
      throw new ValidationError("Check the highlighted fields.", {
        limit: ["Enter a limit above zero, or leave it blank for none"],
      });
    }
  }
  return db.$transaction(async (tx) => {
    const after = await tx.expenseCategory.update({
      where: { id },
      data: {
        name: data.name,
        accountCode: data.accountCode,
        limitMinor,
        limitCurrency: limitMinor === null ? null : "INR",
        receiptRequired: data.receiptRequired,
        status: data.archived ? "ARCHIVED" : "ACTIVE",
      },
    });
    const changes = diffChanges(before, after, FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "expense_category.updated",
        targetType: "expense_category",
        targetId: id,
        changes,
      });
    }
    return after;
  });
}
