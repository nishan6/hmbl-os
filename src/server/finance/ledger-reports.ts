import "server-only";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { signedBalance, toColumns } from "@/lib/ledger";
import { ACCOUNT_TYPES } from "./accounts-default";
import { listAccounts } from "./accounts";

/**
 * The trial balance as at a date: every account's balance from posted
 * journals, as a debit or a credit. The two columns are always equal; a
 * difference would mean the ledger is broken, so it is reported, not hidden.
 */
export async function trialBalance(actor: Actor, legalEntityId: string, asAt: Date) {
  const entity = await getLegalEntity(actor, legalEntityId);
  const accounts = await listAccounts(actor, legalEntityId, { includeArchived: true, asAt });
  const rows = accounts
    .filter((a) => a.netDebitMinor !== 0n)
    .map((a) => ({
      account: { id: a.id, code: a.code, name: a.name, type: a.type, status: a.status },
      ...toColumns(a.netDebitMinor),
    }));
  const totals = rows.reduce(
    (t, r) => ({
      debitMinor: t.debitMinor + r.debitMinor,
      creditMinor: t.creditMinor + r.creditMinor,
    }),
    { debitMinor: 0n, creditMinor: 0n },
  );
  return {
    entity,
    asAt,
    rows,
    totals,
    balanced: totals.debitMinor === totals.creditMinor,
  };
}

/**
 * One account's postings between two dates, with the balance brought
 * forward and a running balance on the account's normal side.
 */
export async function accountLedger(
  actor: Actor,
  accountId: string,
  range: { from: Date; to: Date },
) {
  const account = await db.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!account) return null;
  await getLegalEntity(actor, account.legalEntityId);
  authorize(actor, "finance.view", { legalEntityId: account.legalEntityId });
  const normal = ACCOUNT_TYPES[account.type].normal;
  const [before, lines] = await Promise.all([
    db.journalLine.aggregate({
      where: { accountId, journal: { status: "POSTED", date: { lt: range.from } } },
      _sum: { debitMinor: true, creditMinor: true },
    }),
    db.journalLine.findMany({
      where: {
        accountId,
        journal: { status: "POSTED", date: { gte: range.from, lte: range.to } },
      },
      include: {
        journal: {
          select: {
            id: true,
            number: true,
            date: true,
            narration: true,
            source: true,
            sourceRef: true,
          },
        },
        project: { select: { id: true, number: true } },
      },
      orderBy: [
        { journal: { date: "asc" } },
        { journal: { postedAt: "asc" } },
        { position: "asc" },
      ],
    }),
  ]);
  const openingMinor = signedBalance(
    normal,
    before._sum.debitMinor ?? 0n,
    before._sum.creditMinor ?? 0n,
  );
  let running = openingMinor;
  let debitMinor = 0n;
  let creditMinor = 0n;
  const rows = lines.map((l) => {
    running += signedBalance(normal, l.debitMinor, l.creditMinor);
    debitMinor += l.debitMinor;
    creditMinor += l.creditMinor;
    return { line: l, balanceMinor: running };
  });
  return {
    account,
    normal,
    openingMinor,
    rows,
    totals: { debitMinor, creditMinor },
    closingMinor: running,
  };
}

/**
 * The day book: every posted journal between two dates with its lines, in
 * posting order, for the accountant. Each line names the party it concerns.
 */
export async function dayBook(
  actor: Actor,
  legalEntityId: string,
  range: { from: Date; to: Date },
) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  const journals = await db.journal.findMany({
    where: { legalEntityId, status: "POSTED", date: { gte: range.from, lte: range.to } },
    include: {
      lines: {
        orderBy: { position: "asc" },
        include: {
          account: { select: { code: true, name: true } },
          project: { select: { number: true } },
        },
      },
    },
    orderBy: [{ date: "asc" }, { postedAt: "asc" }, { number: "asc" }],
  });
  const ids = (type: string) => [
    ...new Set(
      journals.flatMap((j) =>
        j.lines.filter((l) => l.partyType === type && l.partyId).map((l) => l.partyId!),
      ),
    ),
  ];
  const [clients, vendors, people] = await Promise.all([
    db.client.findMany({ where: { id: { in: ids("CLIENT") } }, select: { id: true, name: true } }),
    db.vendor.findMany({ where: { id: { in: ids("VENDOR") } }, select: { id: true, name: true } }),
    db.user.findMany({ where: { id: { in: ids("PERSON") } }, select: { id: true, name: true } }),
  ]);
  const names = new Map([...clients, ...vendors, ...people].map((p) => [p.id, p.name]));
  let debitMinor = 0n;
  let creditMinor = 0n;
  for (const j of journals)
    for (const l of j.lines) {
      debitMinor += l.debitMinor;
      creditMinor += l.creditMinor;
    }
  return {
    journals: journals.map((j) => ({
      ...j,
      lines: j.lines.map((l) => ({
        ...l,
        partyName: l.partyId ? (names.get(l.partyId) ?? null) : null,
      })),
    })),
    totals: { debitMinor, creditMinor },
  };
}
