import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ExpenseClaimStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { postJournal, reverseJournal, systemAccount } from "@/server/finance/ledger";
import { financeNumber } from "@/server/finance/numbering";
import { postDocumentCost, voidDocumentCost } from "@/server/projects/budget";
import { cleanFileName, contentTypeFor, isBlocked } from "@/server/projects/document-rules";
import { optionalId, requiredDate } from "@/server/projects/schemas";
import { discardFile, readFile, writeFile } from "@/server/storage/files";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatMoney } from "@/lib/format";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { listExpenseCategories } from "./categories";

/*
 * Expense claims (docs/expenses.md).
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──void──▶ VOIDED
 *     ▲                  │ send back
 *     └──────────────────┘
 *   DRAFT ──discard──▶ DISCARDED
 *
 * Anyone with `expenses.create` claims what they spent, with receipts, and
 * submits (`expenses.submit`). The project manager of every project on the
 * claim approves it, or Finance (`finance.approve`); nobody approves their
 * own claim. Approval posts the claim to reimbursements payable and records
 * project lines as actual costs. Finance then settles it from the person's
 * advances or pays it (src/server/finance/expense-settlements.ts).
 */

type Tx = Prisma.TransactionClient;

export const CLAIM_STATUSES: Record<ExpenseClaimStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Awaiting approval",
  APPROVED: "Approved",
  VOIDED: "Voided",
  DISCARDED: "Discarded",
};

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

/** Settled amounts of claims: live settlements from advances and payments. */
export async function claimSettlements(client: Tx | typeof db, claimIds: string[]) {
  const rows = claimIds.length
    ? await client.expenseSettlement.groupBy({
        by: ["claimId"],
        where: { claimId: { in: claimIds }, voidedAt: null },
        _sum: { amountMinor: true },
      })
    : [];
  const map = new Map(claimIds.map((id) => [id, 0n]));
  for (const r of rows) map.set(r.claimId, r._sum.amountMinor ?? 0n);
  return map;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const listInclude = {
  claimant: { select: { id: true, name: true } },
  legalEntity: { select: { id: true, code: true } },
} as const;

async function withOutstanding<T extends { id: string; status: string; totalMinor: bigint }>(
  claims: T[],
) {
  const settled = await claimSettlements(
    db,
    claims.filter((c) => c.status === "APPROVED").map((c) => c.id),
  );
  return claims.map((c) => {
    const settledMinor = settled.get(c.id) ?? 0n;
    return {
      ...c,
      settledMinor,
      outstandingMinor: c.status === "APPROVED" ? c.totalMinor - settledMinor : 0n,
    };
  });
}

/** The actor's own claims. */
export async function listMyClaims(actor: Actor) {
  authorize(actor, "expenses.view");
  const claims = await db.expenseClaim.findMany({
    where: { claimantId: actor.id, status: { not: "DISCARDED" } },
    include: listInclude,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return withOutstanding(claims);
}

/** Every claim in an entity, for Finance. */
export async function listClaims(
  actor: Actor,
  options: { legalEntityId?: string | null; status?: ExpenseClaimStatus; search?: string } = {},
) {
  authorize(actor, "finance.view");
  const q = options.search?.trim();
  const claims = await db.expenseClaim.findMany({
    where: {
      ...entityFilter(actor, "finance.view"),
      ...(options.legalEntityId ? { legalEntityId: options.legalEntityId } : {}),
      ...(options.status
        ? { status: options.status }
        : { status: { notIn: ["DRAFT", "DISCARDED"] } }),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { title: { contains: q, mode: "insensitive" } },
              { claimant: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: listInclude,
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return withOutstanding(claims);
}

/** Whether the actor manages every project on the claim (and there is at least one). */
async function managesAllProjects(actor: Actor, claimId: string) {
  const lines = await db.expenseClaimLine.findMany({
    where: { claimId },
    select: { project: { select: { projectManagerId: true } } },
  });
  return lines.length > 0 && lines.every((l) => l.project?.projectManagerId === actor.id);
}

async function canApprove(
  actor: Actor,
  claim: { id: string; legalEntityId: string; claimantId: string },
) {
  if (claim.claimantId === actor.id) return false;
  return (
    can(actor, "finance.approve", { legalEntityId: claim.legalEntityId }) ||
    (await managesAllProjects(actor, claim.id))
  );
}

/** The claim, if the actor may see it: its claimant, Finance, or an approver. */
async function loadClaim(actor: Actor, id: string) {
  const claim = await db.expenseClaim.findUnique({ where: { id } });
  if (!claim) throw new NotFoundError();
  if (claim.claimantId === actor.id && can(actor, "expenses.view")) return claim;
  if (can(actor, "finance.view", { legalEntityId: claim.legalEntityId })) return claim;
  if (
    (claim.status === "SUBMITTED" || claim.status === "APPROVED") &&
    (await managesAllProjects(actor, id))
  ) {
    return claim;
  }
  throw new NotFoundError();
}

export async function getClaim(actor: Actor, id: string) {
  await loadClaim(actor, id);
  const claim = await db.expenseClaim.findUniqueOrThrow({
    where: { id },
    include: {
      legalEntity: { select: { id: true, code: true, baseCurrency: true, timezone: true } },
      claimant: { select: { id: true, name: true, email: true } },
      lines: {
        orderBy: { position: "asc" },
        include: {
          category: { select: { id: true, name: true, receiptRequired: true } },
          account: { select: { id: true, code: true, name: true } },
          project: { select: { id: true, number: true, name: true } },
        },
      },
      receipts: { orderBy: { createdAt: "asc" } },
      settlements: {
        orderBy: { createdAt: "asc" },
        include: {
          advance: { select: { id: true, number: true } },
          paidFrom: { select: { code: true, name: true } },
        },
      },
    },
  });
  const budgetLines = await db.projectBudgetLine.findMany({
    where: { id: { in: claim.lines.map((l) => l.budgetLineId).filter((x): x is string => !!x) } },
    select: { id: true, description: true },
  });
  const settledMinor = claim.settlements
    .filter((s) => !s.voidedAt)
    .reduce((s, x) => s + x.amountMinor, 0n);
  const approved = claim.status === "APPROVED";
  const outstandingMinor = approved ? claim.totalMinor - settledMinor : 0n;
  const scope = { legalEntityId: claim.legalEntityId };
  const own = claim.claimantId === actor.id;
  const submitted = claim.status === "SUBMITTED";
  return {
    ...claim,
    budgetLines,
    settledMinor,
    outstandingMinor,
    actions: {
      edit: claim.status === "DRAFT" && own && can(actor, "expenses.create"),
      attach: (claim.status === "DRAFT" || submitted) && own && can(actor, "expenses.create"),
      submit: claim.status === "DRAFT" && own && can(actor, "expenses.submit"),
      discard: claim.status === "DRAFT" && own,
      approve: submitted && (await canApprove(actor, claim)),
      reject: submitted && (await canApprove(actor, claim)),
      settle: approved && outstandingMinor > 0n && can(actor, "finance.post", scope),
      void: approved && settledMinor === 0n && can(actor, "finance.void", scope),
      voidSettlement: can(actor, "finance.void", scope),
    },
  };
}

/** Submitted claims the actor can approve, oldest first. */
export async function claimsAwaitingApproval(actor: Actor) {
  const claims = await db.expenseClaim.findMany({
    where: { status: "SUBMITTED", claimantId: { not: actor.id } },
    include: {
      claimant: { select: { name: true } },
      lines: { select: { project: { select: { id: true, projectManagerId: true } } } },
    },
    orderBy: { submittedAt: "asc" },
  });
  return claims.filter(
    (c) =>
      can(actor, "finance.approve", { legalEntityId: c.legalEntityId }) ||
      (c.lines.length > 0 && c.lines.every((l) => l.project?.projectManagerId === actor.id)),
  );
}

/** Entities to claim against, categories, and open projects with budget lines. */
export async function claimFormOptions(actor: Actor, legalEntityId?: string) {
  authorize(actor, "expenses.create");
  const [entities, categories] = await Promise.all([
    db.legalEntity.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, code: true, legalName: true, baseCurrency: true },
      orderBy: { code: "asc" },
    }),
    listExpenseCategories(),
  ]);
  const projects = legalEntityId
    ? await db.project.findMany({
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
            select: { id: true, description: true },
            orderBy: { position: "asc" },
          },
        },
        orderBy: { number: "desc" },
      })
    : [];
  return { entities, categories, projects };
}

// ─── Drafting ────────────────────────────────────────────────────────────────

const startInput = z.object({
  legalEntityId: z.uuid({ message: "Choose the company the money was spent for" }),
  title: requiredText(200),
});

export async function createClaim(actor: Actor, raw: z.input<typeof startInput>) {
  authorize(actor, "expenses.create");
  const data = parseInput(startInput, raw);
  const entity = await db.legalEntity.findUnique({ where: { id: data.legalEntityId } });
  if (!entity || entity.status !== "ACTIVE") throw invalid("legalEntityId", "Choose a company");
  return db.$transaction(async (tx) => {
    const claim = await tx.expenseClaim.create({
      data: {
        legalEntityId: entity.id,
        claimantId: actor.id,
        title: data.title,
        currency: entity.baseCurrency,
        createdById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "expense_claim.drafted",
      targetType: "expense_claim",
      targetId: claim.id,
      legalEntityId: entity.id,
    });
    return claim;
  });
}

const lineInput = z.object({
  id: optionalId,
  date: requiredDate,
  categoryId: z.uuid({ message: "Choose a category" }),
  description: requiredText(300),
  merchant: optionalText(200),
  projectId: optionalId,
  budgetLineId: optionalId,
  amount: z.string().trim().min(1, "Enter the amount"),
  spentCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{3})?$/, "Use a three-letter currency code")
    .nullish()
    .transform((v) => v || null),
  spentAmount: z.string().trim().nullish(),
  policyNote: optionalText(500),
});
export type ClaimLineInput = z.input<typeof lineInput>;

const draftInput = z.object({
  title: requiredText(200),
  notes: optionalText(2000),
  lines: z.array(lineInput).max(100),
});
export type ClaimDraftInput = z.input<typeof draftInput>;

async function lockClaim(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM expense_claims WHERE id = ${id}::uuid FOR UPDATE`;
  const claim = await tx.expenseClaim.findUnique({ where: { id } });
  if (!claim) throw new NotFoundError();
  return claim;
}

function requireStatus(claim: { status: ExpenseClaimStatus }, ...allowed: ExpenseClaimStatus[]) {
  if (!allowed.includes(claim.status)) {
    throw new ConflictError(
      `This claim is ${CLAIM_STATUSES[claim.status].toLowerCase()}, so it can't do that.`,
    );
  }
}

function requireOwn(actor: Actor, claim: { claimantId: string }) {
  if (claim.claimantId !== actor.id) throw new ForbiddenError();
}

/** Saves a draft's lines, keeping each line's id so its receipts stay attached. */
export async function saveClaimDraft(actor: Actor, id: string, raw: ClaimDraftInput) {
  authorize(actor, "expenses.create");
  const before = await loadClaim(actor, id);
  requireOwn(actor, before);
  const data = parseInput(draftInput, raw);
  const currency = before.currency;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const [categories, accounts, projects] = await Promise.all([
    listExpenseCategories(),
    db.ledgerAccount.findMany({
      where: { legalEntityId: before.legalEntityId, status: "ACTIVE" },
      select: { id: true, code: true },
    }),
    db.project.findMany({
      where: { id: { in: data.lines.map((l) => l.projectId).filter((x): x is string => !!x) } },
      include: { budgetLines: { select: { id: true } } },
    }),
  ]);
  const lines = data.lines.map((l, i) => {
    const field = (name: string) => `lines.${i}.${name}`;
    if (l.date! > today) throw invalid(field("date"), "The date can't be in the future");
    const category = categories.find((c) => c.id === l.categoryId);
    if (!category) throw invalid(field("categoryId"), "Choose an active category");
    const account = accounts.find((a) => a.code === category.accountCode);
    if (!account) {
      throw invalid(
        field("categoryId"),
        `This company's chart has no active account ${category.accountCode} for ${category.name}`,
      );
    }
    const amountMinor = parseMoneyToMinor(l.amount, currency);
    if (amountMinor === null || amountMinor <= 0n) {
      throw invalid(field("amount"), "Enter an amount above zero");
    }
    let spentAmountMinor: bigint | null = null;
    if (l.spentCurrency) {
      if (l.spentCurrency === currency) {
        throw invalid(field("spentCurrency"), `Leave this blank for spending in ${currency}`);
      }
      spentAmountMinor = l.spentAmount ? parseMoneyToMinor(l.spentAmount, l.spentCurrency) : null;
      if (spentAmountMinor === null || spentAmountMinor <= 0n) {
        throw invalid(field("spentAmount"), `Enter what was spent in ${l.spentCurrency}`);
      }
    }
    if (l.projectId) {
      const project = projects.find((p) => p.id === l.projectId);
      if (
        !project ||
        project.legalEntityId !== before.legalEntityId ||
        !project.baselineLockedAt ||
        project.status === "CLOSED" ||
        project.status === "CANCELLED"
      ) {
        throw invalid(field("projectId"), "Choose an open project of this company");
      }
      if (project.currency !== currency) {
        throw invalid(field("projectId"), `This project is in ${project.currency}`);
      }
      if (!l.budgetLineId || !project.budgetLines.some((b) => b.id === l.budgetLineId)) {
        throw invalid(field("budgetLineId"), "Choose the budget line this cost belongs to");
      }
    } else if (l.budgetLineId) {
      throw invalid(field("projectId"), "Choose the project of the budget line");
    }
    const overLimit =
      category.limitMinor !== null &&
      category.limitCurrency === currency &&
      amountMinor > category.limitMinor;
    return {
      id: l.id ?? null,
      position: i,
      date: l.date!,
      categoryId: category.id,
      description: l.description,
      merchant: l.merchant,
      accountId: account.id,
      projectId: l.projectId ?? null,
      budgetLineId: l.projectId ? (l.budgetLineId ?? null) : null,
      amountMinor,
      spentCurrency: l.spentCurrency,
      spentAmountMinor,
      overLimit,
      policyNote: l.policyNote,
    };
  });
  const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0n);
  return db.$transaction(async (tx) => {
    const claim = await lockClaim(tx, id);
    requireStatus(claim, "DRAFT");
    const existing = await tx.expenseClaimLine.findMany({
      where: { claimId: id },
      select: { id: true },
    });
    const keep = new Set(lines.map((l) => l.id).filter((x): x is string => !!x));
    for (const l of lines) {
      if (l.id && !existing.some((e) => e.id === l.id)) {
        throw new ValidationError("A line on this claim changed. Reload and try again.");
      }
    }
    await tx.expenseClaimLine.deleteMany({
      where: { claimId: id, id: { notIn: [...keep] } },
    });
    for (const { id: lineId, ...line } of lines) {
      if (lineId) await tx.expenseClaimLine.update({ where: { id: lineId }, data: line });
      else await tx.expenseClaimLine.create({ data: { ...line, claimId: id } });
    }
    const after = await tx.expenseClaim.update({
      where: { id },
      data: { title: data.title, notes: data.notes, totalMinor },
    });
    await recordAudit(tx, actor, {
      action: "expense_claim.draft_saved",
      targetType: "expense_claim",
      targetId: id,
      legalEntityId: claim.legalEntityId,
      metadata: { totalMinor: totalMinor.toString(), lines: lines.length },
    });
    return after;
  });
}

/** Each line's policy problems: over its category's limit, or a missing receipt. */
function policyIssues(
  line: {
    amountMinor: bigint;
    overLimit: boolean;
    category: { name: string; limitMinor: bigint | null; receiptRequired: boolean };
    receipts: unknown[];
  },
  currency: string,
) {
  const issues: string[] = [];
  if (line.overLimit && line.category.limitMinor !== null) {
    issues.push(
      `over the ${formatMoney(line.category.limitMinor, currency)} limit for ${line.category.name}`,
    );
  }
  if (line.category.receiptRequired && !line.receipts.length) issues.push("no receipt attached");
  return issues;
}

/**
 * Submits a draft for approval, numbering it the first time. A line over its
 * category's limit or without a needed receipt must say why.
 */
export async function submitClaim(actor: Actor, id: string) {
  authorize(actor, "expenses.submit");
  const before = await loadClaim(actor, id);
  requireOwn(actor, before);
  return db.$transaction(async (tx) => {
    const claim = await lockClaim(tx, id);
    requireStatus(claim, "DRAFT");
    const lines = await tx.expenseClaimLine.findMany({
      where: { claimId: id },
      include: { category: true, receipts: { select: { id: true } } },
      orderBy: { position: "asc" },
    });
    if (!lines.length) throw new ValidationError("Add at least one expense first.");
    const errors: Record<string, string[]> = {};
    for (const [i, line] of lines.entries()) {
      const issues = policyIssues(line, claim.currency);
      if (issues.length && !line.policyNote) {
        errors[`lines.${i}.policyNote`] = [`Say why: ${issues.join(" and ")}`];
      }
      await tx.expenseClaimLine.update({
        where: { id: line.id },
        data: {
          missingReceipt: line.category.receiptRequired && !line.receipts.length,
        },
      });
    }
    if (Object.keys(errors).length) {
      throw new ValidationError("Some expenses need a reason. Edit the claim to add them.", errors);
    }
    const number =
      claim.number ??
      (
        await financeNumber(tx, actor, {
          documentType: "expense_claim",
          legalEntityId: claim.legalEntityId,
          date: new Date(),
        })
      ).number;
    const after = await tx.expenseClaim.update({
      where: { id },
      data: { status: "SUBMITTED", number, submittedAt: new Date(), rejectedReason: null },
    });
    await recordAudit(tx, actor, {
      action: "expense_claim.submitted",
      targetType: "expense_claim",
      targetId: id,
      legalEntityId: claim.legalEntityId,
      changes: { status: { from: "DRAFT", to: "SUBMITTED" } },
      metadata: { number, totalMinor: claim.totalMinor.toString() },
    });
    return after;
  });
}

export async function rejectClaim(actor: Actor, id: string, raw: { reason?: string | null }) {
  const claim = await loadClaim(actor, id);
  if (!(await canApprove(actor, claim))) throw new ForbiddenError();
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  return db.$transaction(async (tx) => {
    requireStatus(await lockClaim(tx, id), "SUBMITTED");
    const after = await tx.expenseClaim.update({
      where: { id },
      data: { status: "DRAFT", rejectedReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "expense_claim.rejected",
      targetType: "expense_claim",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "SUBMITTED", to: "DRAFT" } },
      metadata: { reason },
    });
    return after;
  });
}

export async function discardClaim(actor: Actor, id: string) {
  const claim = await loadClaim(actor, id);
  requireOwn(actor, claim);
  return db.$transaction(async (tx) => {
    requireStatus(await lockClaim(tx, id), "DRAFT");
    const after = await tx.expenseClaim.update({ where: { id }, data: { status: "DISCARDED" } });
    await recordAudit(tx, actor, {
      action: "expense_claim.discarded",
      targetType: "expense_claim",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "DRAFT", to: "DISCARDED" } },
    });
    return after;
  });
}

/**
 * Approves a submitted claim and posts it on its latest expense date:
 *
 *   Dr each line's account (with its project)   amount
 *   Cr reimbursements payable (the claimant)    total
 *
 * Project lines are recorded as actual costs against their budget lines.
 */
export async function approveClaim(actor: Actor, id: string) {
  const claim = await loadClaim(actor, id);
  if (!(await canApprove(actor, claim))) {
    throw claim.claimantId === actor.id
      ? new ForbiddenError("You can't approve your own expense claim.")
      : new ForbiddenError();
  }
  return db.$transaction(async (tx) => {
    const current = await lockClaim(tx, id);
    requireStatus(current, "SUBMITTED");
    const [claimant, lines] = await Promise.all([
      tx.user.findUniqueOrThrow({ where: { id: current.claimantId } }),
      tx.expenseClaimLine.findMany({
        where: { claimId: id },
        include: { project: true },
        orderBy: { position: "asc" },
      }),
    ]);
    const date = lines.reduce((d, l) => (l.date > d ? l.date : d), lines[0]!.date);
    for (const l of lines) {
      if (l.project && l.budgetLineId) {
        const entry = await postDocumentCost(tx, actor, {
          projectId: l.project.id,
          budgetLineId: l.budgetLineId,
          amountMinor: l.amountMinor,
          entryDate: l.date,
          description: l.description,
          supplier: l.merchant ?? claimant.name,
          reference: `${current.number} (${claimant.name})`,
          sourceType: "expense_claim_line",
          sourceId: l.id,
          createdById: actor.id,
        });
        await tx.expenseClaimLine.update({ where: { id: l.id }, data: { costEntryId: entry.id } });
      }
    }
    const payable = await systemAccount(tx, current.legalEntityId, "REIMBURSEMENTS_PAYABLE");
    const journal = await postJournal(tx, actor, {
      legalEntityId: current.legalEntityId,
      date,
      source: "EXPENSE_CLAIM",
      sourceId: id,
      sourceRef: current.number,
      narration: `Expense claim ${current.number} by ${claimant.name}: ${current.title}`,
      idempotencyKey: `expense_claim:${id}`,
      isDemo: current.isDemo,
      lines: [
        ...lines.map((l) => ({
          accountId: l.accountId,
          debitMinor: l.amountMinor,
          description: l.description,
          projectId: l.projectId,
        })),
        {
          accountId: payable.id,
          creditMinor: current.totalMinor,
          partyType: "PERSON" as const,
          partyId: claimant.id,
        },
      ],
    });
    const after = await tx.expenseClaim.update({
      where: { id },
      data: {
        status: "APPROVED",
        journalId: journal.id,
        approvedAt: new Date(),
        approvedById: actor.id,
      },
    });
    await recordAudit(tx, actor, {
      action: "expense_claim.approved",
      targetType: "expense_claim",
      targetId: id,
      legalEntityId: after.legalEntityId,
      changes: { status: { from: "SUBMITTED", to: "APPROVED" } },
      metadata: { journal: journal.number, totalMinor: after.totalMinor.toString() },
    });
    return after;
  });
}

const voidInput = z.object({ date: requiredDate, reason: requiredText(500) });

/** Voids an approved claim before any of it is settled: reverses its journal and project costs. */
export async function voidClaim(actor: Actor, id: string, raw: z.input<typeof voidInput>) {
  const claim = await loadClaim(actor, id);
  authorize(actor, "finance.void", { legalEntityId: claim.legalEntityId });
  const data = parseInput(voidInput, raw);
  return db.$transaction(async (tx) => {
    const current = await lockClaim(tx, id);
    requireStatus(current, "APPROVED");
    const journal = await tx.journal.findUniqueOrThrow({ where: { id: current.journalId! } });
    if (data.date! < journal.date) {
      throw invalid("date", "A claim can't be voided before it was posted");
    }
    const settled = await tx.expenseSettlement.count({ where: { claimId: id, voidedAt: null } });
    if (settled) {
      throw new ConflictError("Part of this claim is settled. Void those settlements first.");
    }
    const reason = `Void of expense claim ${current.number}: ${data.reason}`;
    const reversal = await reverseJournal(tx, actor, journal.id, { date: data.date!, reason });
    const lines = await tx.expenseClaimLine.findMany({
      where: { claimId: id, costEntryId: { not: null } },
    });
    for (const l of lines) await voidDocumentCost(tx, actor, l.costEntryId!, reason);
    const after = await tx.expenseClaim.update({
      where: { id },
      data: {
        status: "VOIDED",
        voidDate: data.date!,
        voidedAt: new Date(),
        voidReason: data.reason,
      },
    });
    await recordAudit(tx, actor, {
      action: "expense_claim.voided",
      targetType: "expense_claim",
      targetId: id,
      legalEntityId: current.legalEntityId,
      changes: { status: { from: "APPROVED", to: "VOIDED" } },
      metadata: { reason: data.reason, reversal: reversal.number },
    });
    return after;
  });
}

// ─── Receipts ────────────────────────────────────────────────────────────────

const receiptInput = z.object({
  fileName: z.string().max(300),
  contentType: z.string().max(200).nullish(),
  lineId: optionalId,
});

/** Streams a receipt to disk and attaches it to the claim, and to one of its lines. */
export async function uploadExpenseReceipt(
  actor: Actor,
  claimId: string,
  raw: z.input<typeof receiptInput>,
  body: ReadableStream<Uint8Array> | null,
) {
  authorize(actor, "expenses.create");
  const claim = await loadClaim(actor, claimId);
  requireOwn(actor, claim);
  requireStatus(claim, "DRAFT", "SUBMITTED");
  const input = parseInput(receiptInput, raw);
  const fileName = cleanFileName(input.fileName);
  if (!fileName || !body) throw invalid("file", "Choose a file");
  if (isBlocked(fileName)) throw invalid("file", "Programs and scripts can't be uploaded");
  if (input.lineId) {
    const line = await db.expenseClaimLine.findUnique({ where: { id: input.lineId } });
    if (!line || line.claimId !== claimId) throw invalid("lineId", "Choose a line of this claim");
  }
  const id = randomUUID();
  const storageKey = `expenses/${claimId}/${id}`;
  const { sizeBytes, sha256 } = await writeFile(storageKey, body);
  try {
    if (sizeBytes === 0n) throw invalid("file", "The file is empty");
    return await db.$transaction(async (tx) => {
      requireStatus(await lockClaim(tx, claimId), "DRAFT", "SUBMITTED");
      const receipt = await tx.expenseReceipt.create({
        data: {
          id,
          claimId,
          lineId: input.lineId ?? null,
          fileName,
          contentType: contentTypeFor(fileName, input.contentType ?? null),
          sizeBytes,
          sha256,
          storageKey,
          uploadedById: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: "expense_claim.receipt_attached",
        targetType: "expense_claim",
        targetId: claimId,
        legalEntityId: claim.legalEntityId,
        metadata: { receiptId: id, fileName, sizeBytes: sizeBytes.toString(), sha256 },
      });
      return receipt;
    });
  } catch (error) {
    await discardFile(storageKey);
    throw error;
  }
}

/** A receipt's record and file, for someone who can see its claim. */
export async function openExpenseReceipt(actor: Actor, id: string) {
  const receipt = await db.expenseReceipt.findUnique({ where: { id } });
  if (!receipt) throw new NotFoundError();
  await loadClaim(actor, receipt.claimId);
  return { receipt, file: await readFile(receipt.storageKey) };
}
