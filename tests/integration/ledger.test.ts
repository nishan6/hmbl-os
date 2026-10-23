import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  createAccount,
  listAccounts,
  setAccountArchived,
  setUpChartOfAccounts,
  updateAccount,
} from "@/server/finance/accounts";
import {
  createJournal,
  discardJournal,
  getJournal,
  listJournals,
  postManualJournal,
  reverseManualJournal,
  updateJournal,
} from "@/server/finance/journals";
import { postJournal, reverseJournal } from "@/server/finance/ledger";
import { accountLedger, trialBalance } from "@/server/finance/ledger-reports";
import { updateFinanceSettings, getFinanceSettings } from "@/server/finance/settings";
import { createLegalEntity } from "@/server/organisation/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { day, makeBooks } from "../helpers/finance";

const lines = (debitId: string, creditId: string, minor: bigint) => [
  { accountId: debitId, debitMinor: minor },
  { accountId: creditId, creditMinor: minor },
];

describe("the chart of accounts", () => {
  it("is created with a new legal entity and can be topped up again safely", async () => {
    const owner = await makeActor("owner");
    const entity = await createLegalEntity(owner, {
      code: "HMBL-AS",
      legalName: "Test Assam Pvt Ltd",
      countryCode: "IN",
      baseCurrency: "INR",
      timezone: "Asia/Kolkata",
    });
    const accounts = await listAccounts(owner, entity.id);
    expect(accounts.find((a) => a.systemKey === "RECEIVABLES")).toMatchObject({
      code: "1200",
      isControl: true,
    });
    expect(accounts.find((a) => a.systemKey === "OUTPUT_IGST")?.code).toBe("2102");
    expect(await setUpChartOfAccounts(owner, entity.id)).toEqual([]);
    expect((await getFinanceSettings(owner, entity.id)).fiscalYearStartMonth).toBe(4);
  });

  it("adds, renames and archives accounts, but not ones in use or with a balance", async () => {
    const { entity, account } = await makeBooks();
    const finance = await makeActor("finance");
    const added = await createAccount(finance, entity.id, {
      code: "6200",
      name: "Staff welfare",
      subtype: "OPERATING_EXPENSE",
    });
    expect(added.type).toBe("EXPENSE");
    await expect(
      createAccount(finance, entity.id, {
        code: "6200",
        name: "Again",
        subtype: "OPERATING_EXPENSE",
      }),
    ).rejects.toThrow(ConflictError);

    await db.$transaction((tx) =>
      postJournal(tx, finance, {
        legalEntityId: entity.id,
        date: day("2026-05-10"),
        source: "MANUAL",
        narration: "Team lunch",
        lines: lines(added.id, account("1000").id, 2_500_00n),
      }),
    );
    await expect(
      updateAccount(finance, added.id, {
        code: "6200",
        name: "Staff welfare",
        subtype: "DIRECT_COST",
      }),
    ).rejects.toThrow(ConflictError);
    await updateAccount(finance, added.id, {
      code: "6201",
      name: "Staff meals",
      subtype: "OPERATING_EXPENSE",
    });
    await expect(setAccountArchived(finance, added.id, true)).rejects.toThrow(/balance/);
    await expect(setAccountArchived(finance, account("1200").id, true)).rejects.toThrow(
      /Automatic/,
    );
    const unused = await setAccountArchived(finance, account("1530").id, true);
    expect(unused.status).toBe("ARCHIVED");
  });
});

describe("posting", () => {
  it("numbers the journal, opens the financial year's periods and keeps the books balanced", async () => {
    const { entity, account } = await makeBooks();
    const journal = await db.$transaction((tx) =>
      postJournal(tx, "system", {
        legalEntityId: entity.id,
        date: day("2026-10-23"),
        source: "MANUAL",
        narration: "Owner's capital",
        lines: lines(account("1000").id, account("3000").id, 1_00_000_00n),
      }),
    );
    expect(journal).toMatchObject({
      status: "POSTED",
      number: "JV/2627/00001",
      totalMinor: 1_00_000_00n,
    });
    const periods = await db.accountingPeriod.findMany({
      where: { legalEntityId: entity.id },
      orderBy: { startDate: "asc" },
    });
    expect(periods.map((p) => p.name)).toEqual([
      "Apr 2026",
      "May 2026",
      "Jun 2026",
      "Jul 2026",
      "Aug 2026",
      "Sep 2026",
      "Oct 2026",
      "Nov 2026",
      "Dec 2026",
      "Jan 2027",
      "Feb 2027",
      "Mar 2027",
    ]);
    expect(periods.find((p) => p.id === journal.periodId)?.name).toBe("Oct 2026");
    const audit = await db.auditEvent.findFirst({
      where: { action: "journal.posted", targetId: journal.id },
    });
    expect(audit).not.toBeNull();
  });

  it("refuses an unbalanced posting and drops zero lines", async () => {
    const { entity, account } = await makeBooks();
    await expect(
      db.$transaction((tx) =>
        postJournal(tx, "system", {
          legalEntityId: entity.id,
          date: day("2026-10-23"),
          source: "MANUAL",
          narration: "Wrong",
          lines: [
            { accountId: account("1000").id, debitMinor: 100n },
            { accountId: account("3000").id, creditMinor: 99n },
          ],
        }),
      ),
    ).rejects.toThrow(ValidationError);
    const posted = await db.$transaction((tx) =>
      postJournal(tx, "system", {
        legalEntityId: entity.id,
        date: day("2026-10-23"),
        source: "MANUAL",
        narration: "With a zero line",
        lines: [
          ...lines(account("1000").id, account("3000").id, 100n),
          { accountId: account("4900").id },
        ],
      }),
    );
    expect(await db.journalLine.count({ where: { journalId: posted.id } })).toBe(2);
    expect(await db.journal.count({ where: { legalEntityId: entity.id } })).toBe(1);
  });

  it("posts once per idempotency key", async () => {
    const { entity, account } = await makeBooks();
    const input = {
      legalEntityId: entity.id,
      date: day("2026-10-23"),
      source: "SALES_INVOICE" as const,
      narration: "Invoice",
      idempotencyKey: "sales_invoice:abc",
      lines: lines(account("1200").id, account("4000").id, 500n),
    };
    const first = await db.$transaction((tx) => postJournal(tx, "system", input));
    const second = await db.$transaction((tx) => postJournal(tx, "system", input));
    expect(second.id).toBe(first.id);
    expect(await db.journal.count({ where: { legalEntityId: entity.id } })).toBe(1);
  });

  it("keeps control accounts for documents and refuses closed periods", async () => {
    const { entity, account } = await makeBooks();
    const post = (source: "MANUAL" | "OPENING_BALANCE", date = "2026-10-23") =>
      db.$transaction((tx) =>
        postJournal(tx, "system", {
          legalEntityId: entity.id,
          date: day(date),
          source,
          narration: "Try",
          lines: lines(account("1200").id, account("4000").id, 500n),
        }),
      );
    await expect(post("MANUAL")).rejects.toThrow(/control account/);
    await expect(post("OPENING_BALANCE")).rejects.toThrow(/control account/);

    await db.$transaction((tx) =>
      postJournal(tx, "system", {
        legalEntityId: entity.id,
        date: day("2026-09-30"),
        source: "MANUAL",
        narration: "September",
        lines: lines(account("1000").id, account("3000").id, 100n),
      }),
    );
    await db.accountingPeriod.updateMany({
      where: { legalEntityId: entity.id, name: "Sep 2026" },
      data: { status: "CLOSED" },
    });
    await expect(
      db.$transaction((tx) =>
        postJournal(tx, "system", {
          legalEntityId: entity.id,
          date: day("2026-09-15"),
          source: "MANUAL",
          narration: "Late",
          lines: lines(account("1000").id, account("3000").id, 100n),
        }),
      ),
    ).rejects.toThrow(/Sep 2026 is closed/);
  });

  it("refuses accounts of another entity", async () => {
    const a = await makeBooks();
    const b = await makeBooks();
    await expect(
      db.$transaction((tx) =>
        postJournal(tx, "system", {
          legalEntityId: a.entity.id,
          date: day("2026-10-23"),
          source: "MANUAL",
          narration: "Cross",
          lines: lines(a.account("1000").id, b.account("3000").id, 100n),
        }),
      ),
    ).rejects.toThrow(/this entity's chart/);
  });
});

describe("the database guards the ledger", () => {
  async function posted() {
    const { entity, account } = await makeBooks();
    const journal = await db.$transaction((tx) =>
      postJournal(tx, "system", {
        legalEntityId: entity.id,
        date: day("2026-10-23"),
        source: "MANUAL",
        narration: "Guarded",
        lines: lines(account("1000").id, account("3000").id, 100n),
      }),
    );
    return { entity, account, journal };
  }

  it("never changes or deletes a posted journal or its lines", async () => {
    const { journal } = await posted();
    await expect(
      db.journal.update({ where: { id: journal.id }, data: { narration: "Edited" } }),
    ).rejects.toThrow(/can't be changed/);
    await expect(db.journal.delete({ where: { id: journal.id } })).rejects.toThrow(
      /can't be deleted/,
    );
    await expect(
      db.journalLine.updateMany({ where: { journalId: journal.id }, data: { debitMinor: 5n } }),
    ).rejects.toThrow(/can't be changed/);
    await expect(db.journalLine.deleteMany({ where: { journalId: journal.id } })).rejects.toThrow(
      /can't be changed/,
    );
  });

  it("refuses to post an unbalanced journal or create one already posted", async () => {
    const { entity, account } = await posted();
    const period = await db.accountingPeriod.findFirstOrThrow({
      where: { legalEntityId: entity.id },
    });
    const draft = await db.journal.create({
      data: {
        legalEntityId: entity.id,
        date: period.startDate,
        narration: "Raw",
        currency: "INR",
        createdByLabel: "Test",
        totalMinor: 100n,
        lines: {
          create: [
            { position: 0, accountId: account("1000").id, debitMinor: 100n },
            { position: 1, accountId: account("3000").id, creditMinor: 90n },
          ],
        },
      },
    });
    await expect(
      db.journal.update({
        where: { id: draft.id },
        data: { status: "POSTED", number: "X1", periodId: period.id, postedAt: new Date() },
      }),
    ).rejects.toThrow(/doesn't balance/);
    await expect(
      db.journal.create({
        data: {
          legalEntityId: entity.id,
          date: period.startDate,
          narration: "Straight to posted",
          currency: "INR",
          createdByLabel: "Test",
          status: "POSTED",
          number: "X2",
          periodId: period.id,
          postedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/created as drafts/);
    await expect(
      db.journalLine.create({
        data: {
          journalId: draft.id,
          position: 5,
          accountId: account("1000").id,
          debitMinor: 1n,
          creditMinor: 1n,
        },
      }),
    ).rejects.toThrow(/journal_lines_amount_check/);
  });
});

describe("reversals", () => {
  it("mirrors the journal once and nets the balances to zero", async () => {
    const { entity, account } = await makeBooks();
    const original = await db.$transaction((tx) =>
      postJournal(tx, "system", {
        legalEntityId: entity.id,
        date: day("2026-10-01"),
        source: "MANUAL",
        narration: "Accrual",
        lines: lines(account("6040").id, account("2900").id, 30_000_00n),
      }),
    );
    const reversal = await db.$transaction((tx) =>
      reverseJournal(tx, "system", original.id, {
        date: day("2026-11-01"),
        reason: "Reverse accrual",
      }),
    );
    expect(reversal).toMatchObject({
      source: "REVERSAL",
      reversalOfId: original.id,
      number: "JV/2627/00002",
    });
    const reversedLines = await db.journalLine.findMany({
      where: { journalId: reversal.id },
      include: { account: true },
      orderBy: { position: "asc" },
    });
    expect(reversedLines.map((l) => [l.account.code, l.debitMinor, l.creditMinor])).toEqual([
      ["6040", 0n, 30_000_00n],
      ["2900", 30_000_00n, 0n],
    ]);
    await expect(
      db.$transaction((tx) =>
        reverseJournal(tx, "system", original.id, { date: day("2026-11-01"), reason: "Again" }),
      ),
    ).rejects.toThrow(/already been reversed/);
    await expect(
      db.$transaction((tx) =>
        reverseJournal(tx, "system", reversal.id, { date: day("2026-11-01"), reason: "x" }),
      ),
    ).rejects.toThrow(/can't itself be reversed/);
    const owner = await makeActor("owner");
    const tb = await trialBalance(owner, entity.id, day("2026-11-30"));
    expect(tb.rows).toEqual([]);
    expect((await trialBalance(owner, entity.id, day("2026-10-31"))).totals.debitMinor).toBe(
      30_000_00n,
    );
  });
});

describe("manual journals", () => {
  it("drafts, edits, posts and reverses with the right permissions", async () => {
    const { entity, account } = await makeBooks();
    const finance = await makeActor("finance");
    const draft = await createJournal(finance, entity.id, {
      date: "2026-10-23",
      narration: "Depreciation October",
      lines: [{ accountId: account("6080").id, debit: "12,500" }],
    });
    expect(draft).toMatchObject({ status: "DRAFT", number: null });
    await expect(postManualJournal(finance, draft.id)).rejects.toThrow(/at least two lines|equal/);
    await updateJournal(finance, draft.id, {
      date: "2026-10-31",
      narration: "Depreciation October",
      lines: [
        { accountId: account("6080").id, debit: "12,500" },
        { accountId: account("1590").id, credit: "12500.00" },
      ],
    });
    await expect(
      updateJournal(finance, draft.id, {
        date: "2026-10-31",
        narration: "Into receivables",
        lines: [
          { accountId: account("1200").id, debit: "1" },
          { accountId: account("4000").id, credit: "1" },
        ],
      }),
    ).resolves.toBeTruthy();
    await expect(postManualJournal(finance, draft.id)).rejects.toThrow(/control account/);
    await updateJournal(finance, draft.id, {
      date: "2026-10-31",
      narration: "Depreciation October",
      lines: [
        { accountId: account("6080").id, debit: "12,500" },
        { accountId: account("1590").id, credit: "12500.00" },
      ],
    });
    const posted = await postManualJournal(finance, draft.id);
    expect(posted).toMatchObject({
      status: "POSTED",
      number: "JV/2627/00001",
      totalMinor: 12_500_00n,
    });
    await expect(
      updateJournal(finance, draft.id, { date: "2026-10-31", narration: "x", lines: [] }),
    ).rejects.toThrow(ConflictError);

    const view = await getJournal(finance, draft.id);
    expect(view.actions).toEqual({ edit: false, post: false, discard: false, reverse: true });
    await reverseManualJournal(finance, draft.id, { date: "2026-11-01", reason: "Wrong rate" });
    expect((await getJournal(finance, draft.id)).reversedBy?.number).toBe("JV/2627/00002");

    const ledger = await accountLedger(finance, account("6080").id, {
      from: day("2026-10-01"),
      to: day("2026-11-30"),
    });
    expect(ledger!.rows.map((r) => r.balanceMinor)).toEqual([12_500_00n, 0n]);
    expect(ledger!.normal).toBe("DEBIT");
  });

  it("discards drafts and lists only the actor's entities", async () => {
    const a = await makeBooks();
    const b = await makeBooks();
    const scoped = await makeScopedActor("finance", a.entity.id);
    const draft = await createJournal(scoped, a.entity.id, {
      date: "2026-10-23",
      narration: "Scrap",
      lines: [{ accountId: a.account("1000").id, debit: "1" }],
    });
    await discardJournal(scoped, draft.id);
    expect(await listJournals(scoped, { legalEntityId: a.entity.id })).toEqual([]);
    await expect(
      createJournal(scoped, b.entity.id, { date: "2026-10-23", narration: "x", lines: [] }),
    ).rejects.toThrow(NotFoundError);
    await expect(trialBalance(scoped, b.entity.id, day("2026-10-23"))).rejects.toThrow(
      NotFoundError,
    );
  });

  it("is closed to people without finance permissions", async () => {
    const { entity, account } = await makeBooks();
    const pm = await makeActor("project_manager");
    const viewer = await makeActor("viewer");
    await expect(listAccounts(pm, entity.id)).rejects.toThrow(ForbiddenError);
    await expect(
      createJournal(viewer, entity.id, {
        date: "2026-10-23",
        narration: "x",
        lines: [{ accountId: account("1000").id, debit: "1" }],
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      updateFinanceSettings(viewer, entity.id, { revenueRecognition: "ON_COMPLETION" }),
    ).rejects.toThrow(ForbiddenError);
    const owner = await makeActor("owner");
    await updateFinanceSettings(owner, entity.id, { revenueRecognition: "ON_COMPLETION" });
    expect((await getFinanceSettings(viewer, entity.id)).revenueRecognition).toBe("ON_COMPLETION");
  });
});
