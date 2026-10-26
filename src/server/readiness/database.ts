import "server-only";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { expectedTriggers, firstFew, plural, type CheckResult } from "@/lib/readiness";
import type { ReadinessContext } from "./context";

/*
 * Database migrations and the protections they install (docs/readiness.md).
 * Migrations are compared with `prisma/migrations` by name and checksum, so
 * an edited, missing or half-applied migration shows up.
 */

type MigrationFile = { name: string; sql: string; checksum: string };

async function migrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: MigrationFile[] = [];
  for (const entry of entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const sql = await readFile(path.join(dir, entry.name, "migration.sql"), "utf8").catch(
      () => null,
    );
    if (sql === null) continue;
    files.push({ name: entry.name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return files;
}

export async function migrationsApplied(context: ReadinessContext): Promise<CheckResult> {
  const files = await migrationFiles(context.migrationsDir);
  const applied = await db.$queryRaw<
    { name: string; checksum: string; finished: boolean; rolledBack: boolean; at: Date | null }[]
  >`
    SELECT migration_name AS name, checksum,
           finished_at IS NOT NULL AS finished,
           rolled_back_at IS NOT NULL AS "rolledBack",
           finished_at AS at
    FROM _prisma_migrations ORDER BY migration_name`;
  const done = applied.filter((a) => a.finished && !a.rolledBack);
  const byName = new Map(done.map((a) => [a.name, a]));
  const pending = files.filter((f) => !byName.has(f.name)).map((f) => f.name);
  const edited = files
    .filter((f) => byName.has(f.name) && byName.get(f.name)!.checksum !== f.checksum)
    .map((f) => f.name);
  const known = new Set(files.map((f) => f.name));
  const unknown = done.filter((a) => !known.has(a.name)).map((a) => a.name);
  const failed = applied.filter((a) => !a.finished && !a.rolledBack).map((a) => a.name);
  const latest = done.at(-1);

  const fail = pending.length + edited.length + failed.length > 0;
  const state = fail ? "fail" : unknown.length ? "warn" : "pass";
  return {
    key: "migrations",
    area: "database",
    title: "Migrations applied",
    state,
    summary: fail
      ? `${plural(pending.length, "migration")} not applied, ${plural(failed.length, "failed migration")}, ${plural(edited.length, "migration")} changed after being applied`
      : unknown.length
        ? `The database has ${plural(unknown.length, "migration")} this copy of HMBL OS doesn't know. It may be older than the database`
        : `All ${files.length} migrations are applied, unchanged`,
    evidence: [
      ...firstFew(pending.map((m) => `Not applied: ${m} (run pnpm db:migrate:deploy)`)),
      ...firstFew(failed.map((m) => `Failed part-way: ${m}`)),
      ...firstFew(edited.map((m) => `Changed after it was applied: ${m}`)),
      ...firstFew(unknown.map((m) => `Unknown to this code: ${m}`)),
      latest
        ? `Latest applied: ${latest.name}${latest.at ? ` on ${latest.at.toISOString().slice(0, 10)}` : ""}`
        : "No migrations applied",
    ],
  };
}

export async function protectiveTriggers(context: ReadinessContext): Promise<CheckResult> {
  const files = await migrationFiles(context.migrationsDir);
  const expected = expectedTriggers(files.map((f) => f.sql));
  const present = await db.$queryRaw<{ name: string; enabled: boolean }[]>`
    SELECT c.relname || '.' || t.tgname AS name, t.tgenabled <> 'D' AS enabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'public'`;
  const found = new Map(present.map((p) => [p.name, p.enabled]));
  const missing = [...expected].filter((t) => !found.has(t)).sort();
  const disabled = [...expected].filter((t) => found.get(t) === false).sort();
  const fail = missing.length + disabled.length > 0;
  return {
    key: "protective-triggers",
    area: "audit",
    title: "Database protections in place",
    state: fail ? "fail" : "pass",
    summary: fail
      ? `${plural(missing.length, "protection")} missing and ${plural(disabled.length, "protection")} switched off`
      : `All ${expected.size} protections the migrations install are present and switched on`,
    evidence: [
      ...firstFew(missing.map((t) => `Missing: ${t}`)),
      ...firstFew(disabled.map((t) => `Switched off: ${t}`)),
      found.get("audit_events.audit_events_append_only")
        ? "The audit log refuses changes and deletions"
        : "The audit log is NOT protected from changes",
    ],
  };
}

/** Records that must each have their audit event (spec §25, "Audit events"). */
const AUDITED: { label: string; action: string; targetType: string; sql: string }[] = [
  {
    label: "Posted journals",
    action: "journal.posted",
    targetType: "journal",
    sql: `SELECT id, COALESCE(number, id::text) AS ref FROM journals WHERE status = 'POSTED'`,
  },
  {
    label: "Issued tax invoices",
    action: "sales_invoice.issued",
    targetType: "sales_invoice",
    sql: `SELECT id, number AS ref FROM sales_invoices
          WHERE status = 'ISSUED' AND "openingItemId" IS NULL`,
  },
  {
    label: "Approved vendor bills",
    action: "vendor_bill.approved",
    targetType: "vendor_bill",
    sql: `SELECT id, number AS ref FROM vendor_bills
          WHERE "approvedAt" IS NOT NULL AND "openingItemId" IS NULL`,
  },
  {
    label: "Receipts",
    action: "receipt.recorded",
    targetType: "receipt",
    sql: `SELECT id, number AS ref FROM receipts`,
  },
  {
    label: "Vendor payments",
    action: "vendor_payment.recorded",
    targetType: "vendor_payment",
    sql: `SELECT id, number AS ref FROM vendor_payments`,
  },
  {
    label: "Closed periods",
    action: "accounting_period.closed",
    targetType: "accounting_period",
    sql: `SELECT id, name AS ref FROM accounting_periods WHERE status = 'CLOSED'`,
  },
];

/** Each posted or approved financial record has its audit event. */
export async function auditCoverage(): Promise<CheckResult> {
  const missing: string[] = [];
  const counts: string[] = [];
  for (const a of AUDITED) {
    const rows = await db.$queryRawUnsafe<{ ref: string; audited: boolean }[]>(
      `SELECT r.ref, EXISTS (
         SELECT 1 FROM audit_events e
         WHERE e."targetType" = $1 AND e."targetId" = r.id::text AND e.action = $2
       ) AS audited
       FROM (${a.sql}) r`,
      a.targetType,
      a.action,
    );
    counts.push(`${a.label}: ${rows.length}`);
    for (const r of rows) if (!r.audited) missing.push(`${a.label}: ${r.ref}`);
  }
  const [{ events, oldest }] = await db.$queryRaw<[{ events: bigint; oldest: Date | null }]>`
    SELECT COUNT(*) AS events, MIN("occurredAt") AS oldest FROM audit_events`;
  return {
    key: "audit-coverage",
    area: "audit",
    title: "Financial records are audited",
    state: missing.length ? "fail" : "pass",
    summary: missing.length
      ? `${plural(missing.length, "record")} without the audit event that should have been written with it`
      : "Every posted journal, issued invoice, approved bill, receipt, payment and closed period has its audit event",
    evidence: [
      ...firstFew(missing.map((m) => `No audit event: ${m}`)),
      counts.join(" · "),
      `${plural(Number(events), "audit event")} in total${oldest ? `, the oldest from ${oldest.toISOString().slice(0, 10)}` : ""}`,
    ],
  };
}
