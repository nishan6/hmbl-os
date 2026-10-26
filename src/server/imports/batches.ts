import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { ImportDecision, ImportOutcome, ImportRowStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import type { Actor } from "@/server/permissions/authorize";
import { parseCsv, toCsv } from "@/lib/csv";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  cleanMapping,
  guessMapping,
  IMPORT_KINDS,
  IMPORT_LIMITS,
  rowFields,
  unmappedRequired,
  type ImportKind,
  type ImportMapping,
} from "@/lib/imports";
import { parseInput } from "@/lib/parse";
import { requiredText } from "@/lib/validation";
import { ADAPTERS, type Errors } from "./kinds";

/*
 * Staged imports (spec §23, docs/imports.md). A file is read into rows and
 * nothing else happens until someone has mapped its columns, looked at the
 * check results, decided what to do with every possible duplicate, and
 * committed it. Invalid rows are never dropped quietly: they stay on the
 * batch with their reasons and can be corrected or downloaded.
 */

const KINDS = Object.keys(IMPORT_KINDS) as [ImportKind, ...ImportKind[]];

/** A batch left mid-commit this long (a crash, a closed tab) may be resumed. */
const STALE_COMMIT_MS = 15 * 60_000;

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

export function importKindsFor(actor: Actor): ImportKind[] {
  return KINDS.filter((k) => ADAPTERS[k].canCreate(actor));
}

function assertKind(actor: Actor, kind: ImportKind) {
  if (!ADAPTERS[kind].canCreate(actor)) throw new ForbiddenError();
}

async function loadBatch(actor: Actor, id: string) {
  const batch = await db.importBatch.findUnique({ where: { id } });
  if (!batch || !ADAPTERS[batch.kind].canCreate(actor)) throw new NotFoundError();
  return batch;
}

type Batch = Awaited<ReturnType<typeof loadBatch>>;

function assertStaged(batch: Batch) {
  if (batch.status !== "STAGED") {
    throw new ConflictError(
      batch.status === "DISCARDED"
        ? "This import was discarded."
        : "This import has been committed and can't change.",
    );
  }
}

const mappingOf = (batch: Batch) => cleanMapping(batch.kind, batch.mapping, batch.headers.length);

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function listImports(actor: Actor) {
  const kinds = importKindsFor(actor);
  if (!kinds.length) throw new ForbiddenError();
  const batches = await db.importBatch.findMany({
    where: { kind: { in: kinds } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const counts = await db.importRow.groupBy({
    by: ["batchId", "status"],
    where: { batchId: { in: batches.map((b) => b.id) } },
    _count: true,
  });
  const people = await names(batches.map((b) => b.createdById));
  return batches.map((b) => ({
    ...b,
    createdBy: people.get(b.createdById) ?? null,
    counts: Object.fromEntries(
      counts.filter((c) => c.batchId === b.id).map((c) => [c.status, c._count]),
    ) as Partial<Record<ImportRowStatus, number>>,
  }));
}

async function names(ids: (string | null)[]) {
  const users = await db.user.findMany({
    where: { id: { in: ids.filter((x): x is string => Boolean(x)) } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

export async function getImport(actor: Actor, id: string) {
  const batch = await loadBatch(actor, id);
  const rows = await db.importRow.findMany({ where: { batchId: id }, orderBy: { line: "asc" } });
  const mapping = mappingOf(batch);
  const people = await names([batch.createdById, batch.committedById, batch.discardedById]);
  const previous = await db.importBatch.findFirst({
    where: { id: { not: id }, kind: batch.kind, sha256: batch.sha256, status: "COMMITTED" },
    select: { id: true, fileName: true, committedAt: true },
    orderBy: { committedAt: "desc" },
  });
  return {
    batch,
    mapping,
    missing: unmappedRequired(batch.kind, mapping),
    fields: IMPORT_KINDS[batch.kind].fields,
    people,
    previous,
    canUpdate: ADAPTERS[batch.kind].canUpdate(actor),
    rows: rows.map((r) => ({
      ...r,
      fields: rowFields(batch.kind, r.values, mapping, r.edits as Record<string, string>),
      errors: r.errors as Errors,
      edits: r.edits as Record<string, string>,
    })),
    plan: planOf(rows),
  };
}

/** What committing would do now, from each row's check result and decision. */
function planOf(rows: { status: ImportRowStatus; decision: ImportDecision | null }[]) {
  const plan = { create: 0, update: 0, skip: 0, rejected: 0, undecided: 0, total: rows.length };
  for (const r of rows) {
    if (r.status === "INVALID") plan.rejected += 1;
    else if (r.status === "VALID") plan.create += 1;
    else if (r.decision === "CREATE") plan.create += 1;
    else if (r.decision === "UPDATE") plan.update += 1;
    else if (r.decision === "SKIP") plan.skip += 1;
    else plan.undecided += 1;
  }
  return plan;
}

// ─── Staging and checking ────────────────────────────────────────────────────

const stageInput = z.object({
  kind: z.enum(KINDS, { message: "Choose what the file holds" }),
  fileName: requiredText(200),
  text: z.string().min(1, "Choose a CSV file"),
});
export type StageInput = z.input<typeof stageInput>;

/** Reads a CSV file into a staged batch, guesses the mapping and checks every row. */
export async function stageImport(actor: Actor, raw: StageInput) {
  const data = parseInput(stageInput, raw);
  assertKind(actor, data.kind);
  if (Buffer.byteLength(data.text) > IMPORT_LIMITS.bytes) {
    throw invalid("text", "The file is over 2 MB. Split it into smaller files.");
  }
  const [headers, ...lines] = parseCsv(data.text);
  if (!headers || !lines.length) {
    throw invalid("text", "The file needs a header row and at least one row of data");
  }
  if (lines.length > IMPORT_LIMITS.rows) {
    throw invalid(
      "text",
      `The file has ${lines.length} rows; import at most ${IMPORT_LIMITS.rows} at a time`,
    );
  }
  const clean = headers.map((h, i) => h.trim() || `Column ${i + 1}`);
  const sha256 = createHash("sha256").update(data.text).digest("hex");
  const batch = await db.$transaction(async (tx) => {
    const created = await tx.importBatch.create({
      data: {
        kind: data.kind,
        fileName: data.fileName,
        sha256,
        headers: clean,
        mapping: guessMapping(data.kind, clean) as Prisma.InputJsonValue,
        rowCount: lines.length,
        createdById: actor.id,
      },
    });
    await tx.importRow.createMany({
      data: lines.map((values, i) => ({
        batchId: created.id,
        // The header is line 1.
        line: i + 2,
        values: values.map((v) => v.slice(0, 2000)),
        status: "INVALID" as const,
      })),
    });
    await recordAudit(tx, actor, {
      action: "import.staged",
      targetType: "import_batch",
      targetId: created.id,
      metadata: { kind: data.kind, fileName: data.fileName, rows: lines.length, sha256 },
    });
    return created;
  });
  await checkBatch(actor, batch);
  return batch;
}

/**
 * Checks every row against the mapping, the module's own rules, the rest of
 * the file and the records that exist. A decision on a duplicate is kept
 * while it still points at the same record.
 */
async function checkBatch(actor: Actor, batch: Batch) {
  const adapter = ADAPTERS[batch.kind];
  const mapping = mappingOf(batch);
  const missing = unmappedRequired(batch.kind, mapping);
  const rows = await db.importRow.findMany({
    where: { batchId: batch.id },
    orderBy: { line: "asc" },
  });
  const seen = new Map<string, number>();
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const row of rows) {
    let status: ImportRowStatus = "VALID";
    let errors: Errors = {};
    let match: Awaited<ReturnType<typeof adapter.match>> = null;
    if (missing.length) {
      status = "INVALID";
      errors = {
        _row: [`Choose a column or a value for ${missing.map((f) => f.label).join(", ")}`],
      };
    } else {
      const fields = rowFields(
        batch.kind,
        row.values,
        mapping,
        row.edits as Record<string, string>,
      );
      const result = await adapter.check(actor, fields);
      if (!result.ok) {
        status = "INVALID";
        errors = result.errors;
      } else {
        const earlier = result.keys.map((k) => seen.get(k)).find((l) => l !== undefined);
        for (const k of result.keys) if (!seen.has(k)) seen.set(k, row.line);
        if (earlier !== undefined) {
          status = "INVALID";
          errors = { _row: [`The same record as line ${earlier} of this file`] };
        } else {
          match = await adapter.match(actor, result.input);
          if (match) status = "DUPLICATE";
        }
      }
    }
    const keepDecision =
      status === "DUPLICATE" &&
      row.decision !== null &&
      row.matchId === match!.id &&
      (row.decision !== "CREATE" || match!.canCreate);
    updates.push(
      db.importRow.update({
        where: { id: row.id },
        data: {
          status,
          errors: errors as Prisma.InputJsonValue,
          matchId: match?.id ?? null,
          matchLabel: match?.label ?? null,
          matchReason: match?.reason ?? null,
          matchCanCreate: match?.canCreate ?? true,
          decision: keepDecision ? row.decision : null,
          decidedById: keepDecision ? row.decidedById : null,
        },
      }),
    );
  }
  for (let i = 0; i < updates.length; i += 500) await db.$transaction(updates.slice(i, i + 500));
}

/** Saves which column (or fixed value) feeds each field, then checks every row again. */
export async function saveMapping(actor: Actor, id: string, raw: unknown) {
  const batch = await loadBatch(actor, id);
  assertStaged(batch);
  const mapping: ImportMapping = cleanMapping(batch.kind, raw, batch.headers.length);
  const updated = await db.$transaction(async (tx) => {
    const after = await tx.importBatch.update({
      where: { id },
      data: { mapping: mapping as Prisma.InputJsonValue },
    });
    await recordAudit(tx, actor, {
      action: "import.mapped",
      targetType: "import_batch",
      targetId: id,
      changes: { mapping: { from: batch.mapping, to: mapping } },
    });
    return after;
  });
  await checkBatch(actor, updated);
  return updated;
}

/** Corrects a row's values (blank removes a correction), then checks the file again. */
export async function correctRow(actor: Actor, rowId: string, raw: Record<string, unknown>) {
  const row = await db.importRow.findUnique({ where: { id: rowId } });
  if (!row) throw new NotFoundError();
  const batch = await loadBatch(actor, row.batchId);
  assertStaged(batch);
  const keys = new Set(IMPORT_KINDS[batch.kind].fields.map((f) => f.key));
  const edits: Record<string, string> = { ...(row.edits as Record<string, string>) };
  for (const [key, value] of Object.entries(raw)) {
    if (!keys.has(key) || typeof value !== "string") continue;
    const mapped = rowFields(batch.kind, row.values, mappingOf(batch))[key];
    if (value.trim() === mapped) delete edits[key];
    else edits[key] = value.trim().slice(0, 2000);
  }
  await db.$transaction(async (tx) => {
    await tx.importRow.update({ where: { id: rowId }, data: { edits } });
    await recordAudit(tx, actor, {
      action: "import.row_corrected",
      targetType: "import_batch",
      targetId: batch.id,
      changes: { edits: { from: row.edits, to: edits } },
      metadata: { line: row.line },
    });
  });
  await checkBatch(actor, batch);
}

const decisionInput = z.object({
  decision: z.enum(["CREATE", "UPDATE", "SKIP"], { message: "Choose what to do" }),
});

/** What to do with a row that looks like an existing record. Never decided automatically. */
export async function decideRow(actor: Actor, rowId: string, raw: z.input<typeof decisionInput>) {
  const { decision } = parseInput(decisionInput, raw);
  const row = await db.importRow.findUnique({ where: { id: rowId } });
  if (!row) throw new NotFoundError();
  const batch = await loadBatch(actor, row.batchId);
  assertStaged(batch);
  if (row.status !== "DUPLICATE")
    throw new ConflictError("Only possible duplicates need a decision.");
  if (decision === "UPDATE" && !ADAPTERS[batch.kind].canUpdate(actor)) throw new ForbiddenError();
  if (decision === "CREATE" && !row.matchCanCreate) {
    throw new ConflictError(`${row.matchReason}: update ${row.matchLabel} or skip this row.`);
  }
  await db.$transaction(async (tx) => {
    await tx.importRow.update({
      where: { id: rowId },
      data: { decision, decidedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "import.row_decided",
      targetType: "import_batch",
      targetId: batch.id,
      metadata: { line: row.line, decision, matchId: row.matchId, reason: row.matchReason },
    });
  });
}

/** One decision for every undecided duplicate, e.g. skip them all. */
export async function decideAll(actor: Actor, id: string, raw: z.input<typeof decisionInput>) {
  const batch = await loadBatch(actor, id);
  assertStaged(batch);
  const { decision } = parseInput(decisionInput, raw);
  const rows = await db.importRow.findMany({
    where: { batchId: id, status: "DUPLICATE", decision: null },
    select: { id: true, matchCanCreate: true },
  });
  for (const r of rows) {
    // Rows that can't be created beside their match are left for a person.
    if (decision === "CREATE" && !r.matchCanCreate) continue;
    await decideRow(actor, r.id, { decision });
  }
}

// ─── Dry run, commit, discard ────────────────────────────────────────────────

/**
 * The dry run: checks the whole file again against today's records and
 * says what committing would do. Nothing is written except the check results.
 */
export async function dryRun(actor: Actor, id: string) {
  const batch = await loadBatch(actor, id);
  assertStaged(batch);
  await checkBatch(actor, batch);
  const rows = await db.importRow.findMany({
    where: { batchId: id },
    select: { status: true, decision: true },
  });
  const plan = planOf(rows);
  const problems: string[] = [];
  if (unmappedRequired(batch.kind, mappingOf(batch)).length)
    problems.push("Required fields aren't mapped");
  if (plan.undecided) problems.push(`${plan.undecided} possible duplicates need a decision`);
  if (plan.update && !ADAPTERS[batch.kind].canUpdate(actor)) {
    problems.push("You may not update existing records");
  }
  if (!plan.create && !plan.update) problems.push("Nothing would be created or updated");
  return { plan, problems, ready: problems.length === 0 };
}

const messageOf = (error: unknown) => {
  if (error instanceof ValidationError) {
    const fields = Object.entries(error.fieldErrors).map(([k, m]) => `${k}: ${m.join(", ")}`);
    return fields.length ? fields.join("; ") : error.message;
  }
  if (error instanceof AppError) return error.message;
  throw error;
};

/**
 * Writes the batch row by row through each module's service, after a fresh
 * dry run. Every row ends with an outcome; a row the service refuses is
 * marked failed with the reason and the rest carry on. A batch interrupted
 * mid-way can be committed again: written rows are not written twice.
 */
export async function commitImport(actor: Actor, id: string) {
  const batch = await loadBatch(actor, id);
  const stale = new Date(Date.now() - STALE_COMMIT_MS);
  const resuming =
    batch.status === "COMMITTING" &&
    batch.commitStartedAt !== null &&
    batch.commitStartedAt < stale;
  if (!resuming) {
    const check = await dryRun(actor, id);
    if (!check.ready)
      throw new ConflictError(`Nothing was imported: ${check.problems.join("; ")}.`);
  }
  // Only one commit at a time: claim the batch.
  const claimed = await db.importBatch.updateMany({
    where: {
      id,
      OR: [{ status: "STAGED" }, { status: "COMMITTING", commitStartedAt: { lt: stale } }],
    },
    data: { status: "COMMITTING", commitStartedAt: new Date() },
  });
  if (!claimed.count) throw new ConflictError("This import is already being committed.");

  const adapter = ADAPTERS[batch.kind];
  const mapping = mappingOf(batch);
  const rows = await db.importRow.findMany({
    where: { batchId: id, outcome: null },
    orderBy: { line: "asc" },
  });
  for (const row of rows) {
    let outcome: ImportOutcome;
    let recordId: string | null = null;
    let message: string | null = null;
    if (row.status === "INVALID") {
      outcome = "REJECTED";
      message = Object.values(row.errors as Errors)
        .flat()
        .join("; ");
    } else if (row.status === "DUPLICATE" && row.decision === "SKIP") {
      outcome = "SKIPPED";
    } else {
      try {
        const fields = rowFields(
          batch.kind,
          row.values,
          mapping,
          row.edits as Record<string, string>,
        );
        const result = await adapter.check(actor, fields);
        if (!result.ok) throw new ValidationError("Check the highlighted fields.", result.errors);
        const record =
          row.status === "DUPLICATE" && row.decision === "UPDATE"
            ? await adapter.update(actor, row.matchId!, result.input)
            : await adapter.create(actor, result.input, row.status === "DUPLICATE");
        outcome = row.status === "DUPLICATE" && row.decision === "UPDATE" ? "UPDATED" : "CREATED";
        recordId = record.id;
      } catch (error) {
        outcome = "FAILED";
        message = messageOf(error);
      }
    }
    await db.importRow.update({
      where: { id: row.id },
      data: { outcome, recordId, outcomeMessage: message?.slice(0, 2000) ?? null },
    });
  }

  const outcomes = await db.importRow.groupBy({
    by: ["outcome"],
    where: { batchId: id },
    _count: true,
  });
  const summary = Object.fromEntries(outcomes.map((o) => [o.outcome, o._count]));
  return db.$transaction(async (tx) => {
    const after = await tx.importBatch.update({
      where: { id },
      data: { status: "COMMITTED", committedAt: new Date(), committedById: actor.id, summary },
    });
    await recordAudit(tx, actor, {
      action: "import.committed",
      targetType: "import_batch",
      targetId: id,
      metadata: { kind: batch.kind, fileName: batch.fileName, ...summary },
    });
    return after;
  });
}

export async function discardImport(actor: Actor, id: string) {
  const batch = await loadBatch(actor, id);
  assertStaged(batch);
  return db.$transaction(async (tx) => {
    const after = await tx.importBatch.update({
      where: { id },
      data: { status: "DISCARDED", discardedAt: new Date(), discardedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "import.discarded",
      targetType: "import_batch",
      targetId: id,
      metadata: { kind: batch.kind, fileName: batch.fileName },
    });
    return after;
  });
}

/**
 * The rows that weren't written (invalid, rejected or failed) as CSV: the
 * file's own columns plus the line number and the reason, ready to correct
 * and import again.
 */
export async function problemRowsCsv(actor: Actor, id: string) {
  const batch = await loadBatch(actor, id);
  const rows = await db.importRow.findMany({
    where: {
      batchId: id,
      OR: [{ status: "INVALID" }, { outcome: { in: ["REJECTED", "FAILED"] } }],
    },
    orderBy: { line: "asc" },
  });
  const reason = (r: (typeof rows)[number]) =>
    r.outcomeMessage ??
    Object.entries(r.errors as Errors)
      .map(([k, m]) => (k === "_row" ? m.join(", ") : `${k}: ${m.join(", ")}`))
      .join("; ");
  return {
    fileName: batch.fileName.replace(/\.csv$/i, "") + "-problems.csv",
    csv: toCsv([
      [...batch.headers, "Line", "Problem"],
      ...rows.map((r) => [...batch.headers.map((_, i) => r.values[i] ?? ""), r.line, reason(r)]),
    ]),
  };
}
