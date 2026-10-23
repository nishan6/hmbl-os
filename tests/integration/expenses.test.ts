import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  approveClaim,
  claimsAwaitingApproval,
  createClaim,
  discardClaim,
  getClaim,
  listMyClaims,
  openExpenseReceipt,
  rejectClaim,
  saveClaimDraft,
  submitClaim,
  uploadExpenseReceipt,
  voidClaim,
  type ClaimLineInput,
} from "@/server/expenses/claims";
import { listExpenseCategories, updateExpenseCategory } from "@/server/expenses/categories";
import {
  getAdvance,
  recordAdvance,
  recordAdvanceReturn,
  voidAdvance,
  type AdvanceInput,
} from "@/server/finance/advances";
import {
  settleClaim,
  settlementOptions,
  staffBalances,
  voidSettlement,
} from "@/server/finance/expense-settlements";
import { trialBalance } from "@/server/finance/ledger-reports";
import { getProjectBudget } from "@/server/projects/budget";
import type { Actor } from "@/server/permissions/authorize";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { day, giveBooks, journalLines, makeBankAccount, makeBooks } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

const body = (text: string) => new Blob([text]).stream();

async function category(key: string) {
  const found = (await listExpenseCategories()).find((c) => c.key === key);
  if (!found) throw new Error(`No category ${key}`);
  return found;
}

async function balance(entityId: string, code: string, asAt = day("2026-12-31")) {
  const owner = await makeActor("owner");
  const tb = await trialBalance(owner, entityId, asAt);
  const row = tb.rows.find((r) => r.account.code === code);
  return row ? row.debitMinor - row.creditMinor : 0n;
}

async function setup() {
  const books = await makeBooks();
  const finance = await makeActor("finance");
  const claimant = await makeActor("sales");
  const bank = await makeBankAccount(books.entity.id);
  return { ...books, finance, claimant, bank };
}

/** Drafts a claim with lines: one ₹1,200 taxi by default. */
async function draftClaim(actor: Actor, entityId: string, lines: Partial<ClaimLineInput>[] = [{}]) {
  const claim = await createClaim(actor, {
    legalEntityId: entityId,
    title: "Site visit, Guwahati",
  });
  const taxi = await category("local_conveyance");
  await saveClaimDraft(actor, claim.id, {
    title: "Site visit, Guwahati",
    lines: lines.map((l) => ({
      date: "2026-09-10",
      categoryId: taxi.id,
      description: "Taxi to the venue",
      amount: "1200",
      ...l,
    })),
  });
  return claim;
}

/** Drafts, submits and has Finance approve a claim. */
async function approvedClaim(
  claimant: Actor,
  finance: Actor,
  entityId: string,
  lines?: Partial<ClaimLineInput>[],
) {
  const claim = await draftClaim(claimant, entityId, lines);
  await submitClaim(claimant, claim.id);
  return approveClaim(finance, claim.id);
}

const advanceInput = (
  personId: string,
  paidFromId: string,
  overrides: Partial<AdvanceInput> = {},
): AdvanceInput => ({
  personId,
  paidFromId,
  purpose: "Load-in float",
  date: "2026-09-01",
  method: "BANK_TRANSFER",
  amount: "5000",
  ...overrides,
});

describe("expense categories", () => {
  it("starts with labelled defaults that Finance can change", async () => {
    const meals = await category("meals");
    expect(meals).toMatchObject({
      accountCode: "5040",
      limitMinor: 1_500_00n,
      receiptRequired: true,
    });
    await expect(
      updateExpenseCategory(await makeActor("sales"), meals.id, {
        name: "Meals",
        accountCode: "5040",
      }),
    ).rejects.toThrow(ForbiddenError);
    const owner = await makeActor("owner");
    const after = await updateExpenseCategory(owner, meals.id, {
      name: "Meals",
      accountCode: "5040",
      limit: "2000",
      receiptRequired: true,
    });
    expect(after.limitMinor).toBe(2_000_00n);
    await updateExpenseCategory(owner, meals.id, {
      name: meals.name,
      accountCode: "5040",
      limit: "1500",
      receiptRequired: true,
    });
  });
});

describe("drafting and submitting a claim", () => {
  it("takes the account from the category and keeps line ids across saves", async () => {
    const { entity, claimant } = await setup();
    const claim = await draftClaim(claimant, entity.id);
    const view = await getClaim(claimant, claim.id);
    expect(view).toMatchObject({ status: "DRAFT", currency: "INR", totalMinor: 1_200_00n });
    expect(view.lines[0]!.account.code).toBe("5030");
    expect(view.actions).toMatchObject({ edit: true, submit: true, approve: false });

    const lineId = view.lines[0]!.id;
    const meals = await category("meals");
    await saveClaimDraft(claimant, claim.id, {
      title: "Site visit",
      lines: [
        {
          id: lineId,
          date: "2026-09-10",
          categoryId: view.lines[0]!.categoryId,
          description: "Taxi",
          amount: "900",
        },
        { date: "2026-09-11", categoryId: meals.id, description: "Crew lunch", amount: "800" },
      ],
    });
    const saved = await getClaim(claimant, claim.id);
    expect(saved.lines.map((l) => l.id)[0]).toBe(lineId);
    expect(saved.totalMinor).toBe(1_700_00n);
    expect(saved.lines[1]!.account.code).toBe("5040");
  });

  it("refuses future dates, and other people's drafts", async () => {
    const { entity, claimant } = await setup();
    await expect(draftClaim(claimant, entity.id, [{ date: "2099-01-01" }])).rejects.toMatchObject({
      fieldErrors: { "lines.0.date": [expect.any(String)] },
    });
    const claim = await draftClaim(claimant, entity.id);
    await expect(getClaim(await makeActor("sales"), claim.id)).rejects.toThrow(NotFoundError);
    await expect(submitClaim(await makeActor("finance"), claim.id)).rejects.toThrow(ForbiddenError);
  });

  it("asks why for a line over its limit or without a needed receipt, and numbers it once", async () => {
    const { entity, claimant } = await setup();
    const meals = await category("meals");
    const claim = await draftClaim(claimant, entity.id, [
      {},
      { categoryId: meals.id, description: "Crew dinner", amount: "4000" },
    ]);
    const lines = (await getClaim(claimant, claim.id)).lines;
    expect(lines.map((l) => l.overLimit)).toEqual([false, true]);
    await expect(submitClaim(claimant, claim.id)).rejects.toMatchObject({
      fieldErrors: { "lines.1.policyNote": [expect.stringMatching(/limit.*and no receipt/)] },
    });

    await uploadExpenseReceipt(
      claimant,
      claim.id,
      { fileName: "dinner.jpg", lineId: lines[1]!.id },
      body("receipt"),
    );
    await saveClaimDraft(claimant, claim.id, {
      title: "Site visit",
      lines: lines.map((l) => ({
        id: l.id,
        date: "2026-09-10",
        categoryId: l.categoryId,
        description: l.description,
        amount: (l.amountMinor / 100n).toString(),
        policyNote: l.overLimit ? "Dinner for eight crew after the load-in" : null,
      })),
    });
    const submitted = await submitClaim(claimant, claim.id);
    expect(submitted.number).toMatch(/^EXP\/\d{2}-?\d{2}\/\d{5}$/);
    // The receipt stayed on its line through the edit.
    const view = await getClaim(claimant, claim.id);
    expect(view.receipts[0]!.lineId).toBe(lines[1]!.id);
    expect(view.lines.map((l) => l.missingReceipt)).toEqual([false, false]);

    const finance = await makeActor("finance");
    await rejectClaim(finance, claim.id, { reason: "Split the dinner per person" });
    const again = await submitClaim(claimant, claim.id);
    expect(again.number).toBe(submitted.number);
  });

  it("stores receipts and serves them only to people who can see the claim", async () => {
    const { entity, claimant } = await setup();
    const claim = await draftClaim(claimant, entity.id);
    const receipt = await uploadExpenseReceipt(
      claimant,
      claim.id,
      { fileName: "taxi.pdf" },
      body("taxi receipt"),
    );
    expect(receipt).toMatchObject({ sizeBytes: 12n, contentType: "application/pdf" });
    const opened = await openExpenseReceipt(claimant, receipt.id);
    expect(await new Response(opened.file.stream).text()).toBe("taxi receipt");
    await expect(openExpenseReceipt(await makeActor("sales"), receipt.id)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      uploadExpenseReceipt(claimant, claim.id, { fileName: "run.exe" }, body("x")),
    ).rejects.toMatchObject({ fieldErrors: { file: [expect.any(String)] } });
    await expect(db.expenseReceipt.delete({ where: { id: receipt.id } })).rejects.toThrow();
  });

  it("lets the claimant discard a draft", async () => {
    const { entity, claimant } = await setup();
    const claim = await draftClaim(claimant, entity.id);
    await discardClaim(claimant, claim.id);
    expect((await listMyClaims(claimant)).map((c) => c.id)).not.toContain(claim.id);
  });
});

describe("approving a claim", () => {
  it("posts the expense against reimbursements payable for the claimant", async () => {
    const { entity, finance, claimant } = await setup();
    const meals = await category("meals");
    const claim = await draftClaim(claimant, entity.id, [
      {},
      { date: "2026-09-12", categoryId: meals.id, description: "Lunch", amount: "600" },
    ]);
    const lunch = (await getClaim(claimant, claim.id)).lines[1]!;
    await uploadExpenseReceipt(
      claimant,
      claim.id,
      { fileName: "lunch.png", lineId: lunch.id },
      body("r"),
    );
    await submitClaim(claimant, claim.id);
    expect((await claimsAwaitingApproval(finance)).map((c) => c.id)).toContain(claim.id);
    expect((await claimsAwaitingApproval(claimant)).map((c) => c.id)).not.toContain(claim.id);

    const approved = await approveClaim(finance, claim.id);
    const journal = await db.journal.findUniqueOrThrow({ where: { id: approved.journalId! } });
    expect(journal.date).toEqual(day("2026-09-12"));
    expect(await journalLines(journal.id)).toEqual([
      ["5030", 1_200_00n, 0n],
      ["5040", 600_00n, 0n],
      ["2220", 0n, 1_800_00n],
    ]);
    const payable = await db.journalLine.findFirstOrThrow({
      where: { journalId: journal.id, account: { code: "2220" } },
    });
    expect(payable).toMatchObject({ partyType: "PERSON", partyId: claimant.id });
    await expect(
      db.expenseClaimLine.updateMany({ where: { claimId: claim.id }, data: { description: "x" } }),
    ).rejects.toThrow(/can't be changed/);
  });

  it("refuses self-approval, even for Finance", async () => {
    const { entity, finance } = await setup();
    const claim = await draftClaim(finance, entity.id);
    await submitClaim(finance, claim.id);
    await expect(approveClaim(finance, claim.id)).rejects.toThrow(
      "You can't approve your own expense claim.",
    );
    expect((await getClaim(finance, claim.id)).actions.approve).toBe(false);
  });

  it("lets the project manager approve and charges the project's budget", async () => {
    const { entity, project } = await makeAcceptedProject();
    await giveBooks(entity.id);
    const pm = await makeActor("project_manager");
    await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
    const [budgetLine] = await db.projectBudgetLine.findMany({
      where: { projectId: project.id },
      orderBy: { position: "asc" },
    });
    const claimant = await makeActor("sales");
    await expect(
      draftClaim(claimant, entity.id, [{ projectId: project.id }]),
    ).rejects.toMatchObject({ fieldErrors: { "lines.0.budgetLineId": [expect.any(String)] } });
    const claim = await draftClaim(claimant, entity.id, [
      { projectId: project.id, budgetLineId: budgetLine!.id },
    ]);
    await expect(getClaim(pm, claim.id)).rejects.toThrow(NotFoundError);
    await submitClaim(claimant, claim.id);
    expect((await getClaim(pm, claim.id)).actions).toMatchObject({ approve: true, settle: false });
    await expect(approveClaim(await makeActor("project_manager"), claim.id)).rejects.toThrow(
      NotFoundError,
    );
    const approved = await approveClaim(pm, claim.id);
    expect(approved.approvedById).toBe(pm.id);

    const owner = await makeActor("owner");
    expect((await getProjectBudget(owner, project.id)).totals.actualMinor).toBe(1_200_00n);
    const [entry] = await db.projectCostEntry.findMany({ where: { projectId: project.id } });
    expect(entry).toMatchObject({ sourceType: "expense_claim_line", amountMinor: 1_200_00n });

    const finance = await makeActor("finance");
    await voidClaim(finance, claim.id, { date: "2026-10-01", reason: "Claimed twice" });
    expect((await getProjectBudget(owner, project.id)).totals.actualMinor).toBe(0n);
    expect(await balance(entity.id, "2220")).toBe(0n);
    expect(await balance(entity.id, "5030")).toBe(0n);
  });
});

describe("advances and settlement", () => {
  it("pays an advance, sets a claim against it and takes back the rest", async () => {
    const { entity, finance, claimant, bank } = await setup();
    await expect(
      recordAdvance(claimant, entity.id, advanceInput(claimant.id, bank.ledgerAccountId)),
    ).rejects.toThrow(ForbiddenError);
    const advance = await recordAdvance(
      finance,
      entity.id,
      advanceInput(claimant.id, bank.ledgerAccountId),
    );
    expect(advance.number).toMatch(/^ADV\//);
    expect(await journalLines(advance.journalId)).toEqual([
      ["1400", 5_000_00n, 0n],
      [expect.any(String), 0n, 5_000_00n],
    ]);

    const claim = await approvedClaim(claimant, finance, entity.id);
    const options = await settlementOptions(finance, claim.id);
    expect(options.advances).toEqual([
      expect.objectContaining({ id: advance.id, leftMinor: 5_000_00n }),
    ]);
    await expect(
      settleClaim(finance, claim.id, { date: "2026-09-15", advanceId: advance.id, amount: "1300" }),
    ).rejects.toMatchObject({ fieldErrors: { amount: [expect.any(String)] } });
    const settlement = await settleClaim(finance, claim.id, {
      date: "2026-09-15",
      advanceId: advance.id,
      amount: "1200",
    });
    expect(await journalLines(settlement.journalId)).toEqual([
      ["2220", 1_200_00n, 0n],
      ["1400", 0n, 1_200_00n],
    ]);
    expect((await getClaim(finance, claim.id)).outstandingMinor).toBe(0n);

    // The database refuses over-using the advance or over-settling the claim.
    await expect(
      db.expenseSettlement.create({
        data: {
          claimId: claim.id,
          kind: "PAYMENT",
          paidFromId: bank.ledgerAccountId,
          date: day("2026-09-16"),
          amountMinor: 1n,
          journalId: randomUUID(),
          createdById: finance.id,
        },
      }),
    ).rejects.toThrow(/over-settled/);

    await expect(
      recordAdvanceReturn(finance, advance.id, {
        date: "2026-09-20",
        depositAccountId: bank.ledgerAccountId,
        amount: "4000",
      }),
    ).rejects.toMatchObject({ fieldErrors: { amount: [expect.any(String)] } });
    await recordAdvanceReturn(finance, advance.id, {
      date: "2026-09-20",
      depositAccountId: bank.ledgerAccountId,
      amount: "3800",
    });
    const view = await getAdvance(finance, advance.id);
    expect(view).toMatchObject({ outstandingMinor: 0n, actions: { return: false, void: false } });
    await expect(
      voidAdvance(finance, advance.id, { date: "2026-09-21", reason: "x" }),
    ).rejects.toThrow(ConflictError);
    expect(await balance(entity.id, "1400")).toBe(0n);
    expect(await balance(entity.id, "2220")).toBe(0n);
  });

  it("refuses an advance paid to someone else", async () => {
    const { entity, finance, claimant, bank } = await setup();
    const other = await makeActor("sales");
    const advance = await recordAdvance(
      finance,
      entity.id,
      advanceInput(other.id, bank.ledgerAccountId),
    );
    const claim = await approvedClaim(claimant, finance, entity.id);
    await expect(
      settleClaim(finance, claim.id, { date: "2026-09-15", advanceId: advance.id, amount: "100" }),
    ).rejects.toMatchObject({ fieldErrors: { advanceId: [expect.any(String)] } });
    await expect(
      db.expenseSettlement.create({
        data: {
          claimId: claim.id,
          kind: "ADVANCE",
          advanceId: advance.id,
          date: day("2026-09-15"),
          amountMinor: 100n,
          journalId: randomUUID(),
          createdById: finance.id,
        },
      }),
    ).rejects.toThrow(/can't settle claim/);
  });

  it("pays a claim, voids the payment and then the claim", async () => {
    const { entity, finance, claimant, bank } = await setup();
    const claim = await approvedClaim(claimant, finance, entity.id);
    await expect(
      settleClaim(finance, claim.id, {
        date: "2026-09-01",
        paidFromId: bank.ledgerAccountId,
        amount: "1200",
      }),
    ).rejects.toMatchObject({ fieldErrors: { date: [expect.any(String)] } });
    const paid = await settleClaim(finance, claim.id, {
      date: "2026-09-30",
      paidFromId: bank.ledgerAccountId,
      amount: "1200",
      reference: "UTR555",
    });
    expect(await journalLines(paid.journalId)).toEqual([
      ["2220", 1_200_00n, 0n],
      [expect.any(String), 0n, 1_200_00n],
    ]);
    await expect(voidClaim(finance, claim.id, { date: "2026-10-01", reason: "x" })).rejects.toThrow(
      ConflictError,
    );
    await voidSettlement(finance, paid.id, {
      date: "2026-10-01",
      reason: "Paid to the wrong account",
    });
    await expect(
      voidSettlement(finance, paid.id, { date: "2026-10-01", reason: "again" }),
    ).rejects.toThrow(ConflictError);
    expect((await getClaim(finance, claim.id)).outstandingMinor).toBe(1_200_00n);
    await voidClaim(finance, claim.id, { date: "2026-10-02", reason: "Claimed twice" });
    expect(await balance(entity.id, "2220")).toBe(0n);
    await expect(
      settleClaim(finance, claim.id, {
        date: "2026-10-03",
        paidFromId: bank.ledgerAccountId,
        amount: "1",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("reports staff balances that agree with the ledger on any date", async () => {
    const { entity, finance, claimant, bank } = await setup();
    const advance = await recordAdvance(
      finance,
      entity.id,
      advanceInput(claimant.id, bank.ledgerAccountId, { amount: "3000" }),
    );
    const claim = await approvedClaim(claimant, finance, entity.id, [
      { amount: "2000", date: "2026-09-10" },
    ]);
    const fromAdvance = await settleClaim(finance, claim.id, {
      date: "2026-09-15",
      advanceId: advance.id,
      amount: "1500",
    });
    await settleClaim(finance, claim.id, {
      date: "2026-09-20",
      paidFromId: bank.ledgerAccountId,
      amount: "500",
    });
    await voidSettlement(finance, fromAdvance.id, { date: "2026-09-25", reason: "Wrong advance" });

    const expectations: [string, bigint, bigint][] = [
      ["2026-09-05", 3_000_00n, 0n],
      ["2026-09-12", 3_000_00n, 2_000_00n],
      ["2026-09-16", 1_500_00n, 500_00n],
      ["2026-09-22", 1_500_00n, 0n],
      ["2026-09-30", 3_000_00n, 1_500_00n],
    ];
    for (const [date, advanceMinor, owedMinor] of expectations) {
      const report = await staffBalances(finance, entity.id, day(date));
      expect(report.totals, date).toEqual({ advanceMinor, owedMinor });
      expect(report.advancesLedgerMinor, date).toBe(advanceMinor);
      expect(report.claimsLedgerMinor, date).toBe(owedMinor);
    }
    const [row] = (await staffBalances(finance, entity.id, day("2026-09-30"))).rows;
    expect(row).toMatchObject({ personId: claimant.id, netMinor: -1_500_00n });
    await expect(staffBalances(claimant, entity.id, day("2026-09-30"))).rejects.toThrow(
      ForbiddenError,
    );
  });
});
