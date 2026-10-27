import { cp, mkdir, mkdtemp, writeFile, utimes, appendFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { approveBill, submitBill } from "@/server/finance/bills";
import { recordPayment } from "@/server/finance/payments";
import { recordReceipt, voidReceipt } from "@/server/finance/receipts";
import { readinessContext, type ReadinessContext } from "@/server/readiness/context";
import {
  controlAccounts,
  documentsPosted,
  duplicatePostings,
  journalsBalance,
} from "@/server/readiness/finance";
import { auditCoverage, migrationsApplied, protectiveTriggers } from "@/server/readiness/database";
import {
  accessControl,
  backups,
  configuration,
  demoIsolation,
} from "@/server/readiness/environment";
import { getReadinessRun, listReadinessRuns, runReadiness } from "@/server/readiness/runs";
import { parseEnv } from "@/lib/env";
import { ForbiddenError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeEntity } from "../helpers/organisation";
import {
  draftBill,
  issueSimpleInvoice,
  makeBankAccount,
  makeBillableClient,
  makeBooks,
  makeVendor,
} from "../helpers/finance";

const NOW = new Date("2026-12-31T12:00:00Z");

const LIVE_ENV = parseEnv({
  APP_ENV: "production",
  DATABASE_URL: "postgresql://hmbl:hmbl@localhost:5432/hmbl_live",
  APP_URL: "http://localhost:3000",
  BETTER_AUTH_SECRET: "a-private-secret-of-at-least-thirty-two-characters",
  STORAGE_DIR: tmpdir(),
});

function context(overrides: Partial<ReadinessContext> = {}): ReadinessContext {
  return readinessContext({ now: NOW, ...overrides });
}

function live(overrides: Partial<ReadinessContext> = {}): ReadinessContext {
  return context({ env: LIVE_ENV, production: true, database: "hmbl_live", ...overrides });
}

/** Books with an invoice part-paid, a voided receipt, and a bill part-paid. */
async function busyBooks() {
  const { entity } = await makeBooks();
  const finance = await makeActor("finance");
  const client = await makeBillableClient();
  const bank = await makeBankAccount(entity.id);
  const invoice = await issueSimpleInvoice(finance, entity.id, client.id);
  const receipt = {
    clientId: client.id,
    depositAccountId: bank.ledgerAccountId,
    date: "2026-10-20",
    method: "BANK_TRANSFER" as const,
    reference: "UTR1",
    currency: "INR",
    amount: "50000",
    allocations: [{ invoiceId: invoice.id, amount: "50000" }],
  };
  await recordReceipt(finance, entity.id, receipt);
  const bounced = await recordReceipt(finance, entity.id, { ...receipt, reference: "UTR2" });
  await voidReceipt(finance, bounced.id, { date: "2026-10-22", reason: "Bounced" });

  const vendor = await makeVendor();
  const bill = await draftBill(finance, entity.id, vendor.id);
  await submitBill(finance, bill.id);
  await approveBill(finance, bill.id);
  await recordPayment(finance, entity.id, {
    vendorId: vendor.id,
    paidFromId: bank.ledgerAccountId,
    date: "2026-10-25",
    method: "BANK_TRANSFER",
    reference: "UTR9",
    currency: "INR",
    amount: "20000",
    allocations: [{ billId: bill.id, amount: "20000" }],
  });
  return { entity, invoice };
}

/** Changes rows the database protects, the way a bug or a hand-edit could. */
async function tamper(
  run: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>,
) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await run(tx);
  });
}

describe("financial invariants", () => {
  it("pass on books kept through the services", async () => {
    const { entity } = await busyBooks();
    const results = await Promise.all([
      journalsBalance(),
      documentsPosted(),
      duplicatePostings(),
      controlAccounts(context()),
      auditCoverage(),
    ]);
    for (const r of results) expect(r, r.key).toMatchObject({ state: "pass" });

    const control = results[3];
    expect(control.evidence.join("\n")).toContain(`${entity.code}: receivables ₹68,000.00`);
    expect(results[1].evidence.at(-1)).toContain("Tax invoices: 1");
    expect(results[1].evidence.at(-1)).toContain("Receipts: 2");
  });

  it("catch a ledger that no longer agrees with its documents", async () => {
    const { entity, invoice } = await busyBooks();
    await tamper((tx) =>
      tx.salesInvoice.update({ where: { id: invoice.id }, data: { baseTotalMinor: 1n } }),
    );
    const control = await controlAccounts(context());
    expect(control.state).toBe("fail");
    expect(control.evidence[0]).toMatch(new RegExp(`^${entity.code} receivables: open items`));
  });

  it("catch a document whose journal was lost or never reversed", async () => {
    const { invoice } = await busyBooks();
    const voided = await db.receipt.findFirstOrThrow({ where: { status: "VOIDED" } });
    await tamper(async (tx) => {
      await tx.journal.updateMany({ where: { id: invoice.journalId! }, data: { status: "DRAFT" } });
      await tx.journal.deleteMany({ where: { reversalOfId: voided.journalId } });
    });
    const docs = await documentsPosted();
    expect(docs.state).toBe("fail");
    expect(docs.evidence).toContain(`No posted journal: Tax invoices: ${invoice.number}`);
    expect(docs.evidence).toContain(`Voided but not reversed: Receipts: ${voided.number}`);
  });

  it("catch an unbalanced journal and a missing audit event", async () => {
    await busyBooks();
    const journal = await db.journal.findFirstOrThrow({
      where: { status: "POSTED", source: "SALES_INVOICE" },
      include: { lines: { orderBy: { position: "asc" }, take: 1 } },
    });
    await tamper(async (tx) => {
      await tx.journalLine.update({
        where: { id: journal.lines[0]!.id },
        data: { debitMinor: { increment: 1n } },
      });
      await tx.auditEvent.deleteMany({ where: { targetId: journal.id, action: "journal.posted" } });
    });
    expect(await journalsBalance()).toMatchObject({ state: "fail" });
    const audit = await auditCoverage();
    expect(audit.state).toBe("fail");
    expect(audit.evidence[0]).toBe(`No audit event: Posted journals: ${journal.number}`);
  });
});

describe("database checks", () => {
  it("find every protection the migrations install, and notice one switched off", async () => {
    expect(await protectiveTriggers(context())).toMatchObject({ state: "pass" });
    await db.$executeRaw`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`;
    try {
      const result = await protectiveTriggers(context());
      expect(result.state).toBe("fail");
      expect(result.evidence).toContain("Switched off: audit_events.audit_events_append_only");
      expect(result.evidence).toContain("The audit log is NOT protected from changes");
    } finally {
      await db.$executeRaw`ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only`;
    }
  });

  it("compare migrations with the database by name and checksum", async () => {
    expect(await migrationsApplied(context())).toMatchObject({ state: "pass" });

    const dir = await mkdtemp(path.join(tmpdir(), "hmbl-migrations-"));
    await cp(path.join(process.cwd(), "prisma", "migrations"), dir, { recursive: true });
    await mkdir(path.join(dir, "29991231000000_future"));
    await writeFile(path.join(dir, "29991231000000_future", "migration.sql"), "SELECT 1;");
    const first = (await readdir(dir)).sort()[0]!;
    await appendFile(path.join(dir, first, "migration.sql"), "\n-- edited\n");

    const result = await migrationsApplied(context({ migrationsDir: dir }));
    expect(result.state).toBe("fail");
    expect(result.evidence).toContain(
      "Not applied: 29991231000000_future (run pnpm db:migrate:deploy)",
    );
    expect(result.evidence).toContain(`Changed after it was applied: ${first}`);
  });
});

describe("environment checks", () => {
  it("allow demo data in development but never in the live database", async () => {
    const demo = await makeEntity();
    await db.legalEntity.update({ where: { id: demo.id }, data: { isDemo: true } });

    expect(await demoIsolation(context())).toMatchObject({ state: "pass" });
    const result = await demoIsolation(live());
    expect(result.state).toBe("fail");
    expect(result.evidence).toContain("legal_entities: 1");

    await db.legalEntity.update({ where: { id: demo.id }, data: { isDemo: false } });
    expect(await demoIsolation(live())).toMatchObject({ state: "pass" });
    expect(await demoIsolation(live({ database: "hmbl_dev" }))).toMatchObject({ state: "fail" });
  });

  it("refuse a published secret or plain HTTP across a network in production", async () => {
    expect(await configuration(live())).toMatchObject({ state: "pass" });

    const published = parseEnv({
      ...LIVE_ENV,
      BETTER_AUTH_SECRET: "replace-me-with-openssl-rand-base64-32-output",
    });
    const result = await configuration(live({ env: published }));
    expect(result.state).toBe("fail");
    expect(result.summary).toContain("BETTER_AUTH_SECRET is a value published in the repository");
    expect(JSON.stringify(result)).not.toContain("replace-me");

    const network = parseEnv({ ...LIVE_ENV, APP_URL: "http://192.168.1.20:3000" });
    expect(await configuration(live({ env: network }))).toMatchObject({ state: "fail" });
    const https = parseEnv({ ...LIVE_ENV, APP_URL: "https://os.hmbl.example" });
    expect(await configuration(live({ env: https }))).toMatchObject({ state: "pass" });
  });

  it("judge backups by age", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hmbl-backups-"));
    expect(await backups(live({ backupDir: dir }))).toMatchObject({ state: "fail" });
    expect(await backups(context({ backupDir: dir, database: "hmbl_live" }))).toMatchObject({
      state: "warn",
    });

    const file = path.join(dir, "hmbl_live-20261231-0100.dump");
    await writeFile(file, "PGDMP");
    const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000);
    await utimes(file, at(11), at(11));
    expect(await backups(live({ backupDir: dir }))).toMatchObject({
      state: "pass",
      summary: "The latest backup is 11 hours old",
    });
    await utimes(file, at(30), at(30));
    expect(await backups(live({ backupDir: dir }))).toMatchObject({ state: "warn" });
    await utimes(file, at(24 * 8), at(24 * 8));
    expect(await backups(live({ backupDir: dir }))).toMatchObject({ state: "fail" });
    // Another database's backups don't count.
    expect(await backups(live({ backupDir: dir, database: "hmbl_other" }))).toMatchObject({
      state: "fail",
    });
  });

  it("need an owner, two-factor where required, and no portal user with an internal role", async () => {
    expect(await accessControl(live())).toMatchObject({ state: "fail" });
    const owner = await makeActor("owner");
    await db.user.update({ where: { id: owner.id }, data: { twoFactorEnabled: true } });
    expect(await accessControl(live())).toMatchObject({ state: "pass" });

    const finance = await makeActor("finance");
    const result = await accessControl(live());
    expect(result.state).toBe("warn");
    expect(result.evidence).toContain(`Two-factor not set up: ${finance.email}`);

    // The database refuses this too; the check is the second line of defence.
    await tamper((tx) => tx.user.update({ where: { id: finance.id }, data: { kind: "EXTERNAL" } }));
    expect(await accessControl(live())).toMatchObject({ state: "fail" });
  });
});

describe("readiness runs", () => {
  it("are kept as evidence, audited, and never changed", async () => {
    await busyBooks();
    const owner = await makeActor("owner");
    const run = await runReadiness(owner, { now: NOW });
    expect(run).toMatchObject({ source: "APP", actorId: owner.id, appEnv: "test" });
    expect(run.passCount + run.warnCount + run.failCount).toBe(run.results.length);
    expect(run.results.find((r) => r.key === "journals-balance")?.state).toBe("pass");

    const fromCommand = await runReadiness("system", { now: NOW });
    expect(fromCommand).toMatchObject({ source: "COMMAND", actorLabel: "pnpm readiness" });

    const admin = await makeActor("administrator");
    expect((await listReadinessRuns(admin)).map((r) => r.id)).toEqual([fromCommand.id, run.id]);
    expect((await getReadinessRun(admin))?.id).toBe(fromCommand.id);
    expect((await getReadinessRun(admin, run.id))?.results).toEqual(run.results);

    const audit = await db.auditEvent.findMany({
      where: { action: "readiness.checked" },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.actorType)).toEqual(["USER", "SYSTEM"]);

    await expect(
      db.readinessRun.update({ where: { id: run.id }, data: { failCount: 0 } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.readinessRun.delete({ where: { id: run.id } })).rejects.toThrow(/append-only/);
  });

  it("are for owners and administrators of every entity only", async () => {
    const { entity } = await makeBooks();
    for (const actor of [
      await makeActor("finance"),
      await makeActor("viewer"),
      await makeScopedActor("owner", entity.id),
    ]) {
      await expect(runReadiness(actor)).rejects.toThrow(ForbiddenError);
      await expect(listReadinessRuns(actor)).rejects.toThrow(ForbiddenError);
      await expect(getReadinessRun(actor)).rejects.toThrow(ForbiddenError);
    }
  });
});
