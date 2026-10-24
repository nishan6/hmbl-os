import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, entityFilter, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { DOCUMENT_TYPES, documentFields, type DocumentType } from "./document-types";
import { addMissingDefaultSchemes } from "./defaults";
import {
  formatNumber,
  patternTokens,
  periodKey,
  validatePattern,
  type DocumentField,
  type NumberContext,
} from "./pattern";
import {
  counterInput,
  numberingSchemeInput,
  replaceSchemeInput,
  type CounterInput,
  type NumberingSchemeInput,
  type ReplaceSchemeInput,
} from "./schemas";

const SCHEME_FIELDS = [
  "documentType",
  "pattern",
  "resetPolicy",
  "fiscalYearStartMonth",
  "startAt",
  "status",
] as const;

function parseScheme(input: NumberingSchemeInput) {
  const data = parseInput(numberingSchemeInput, input);
  const problems = validatePattern(data, documentFields(data.documentType as DocumentType));
  if (problems.length) throw new ValidationError(problems[0]!, { pattern: problems });
  return data;
}

/** Stand-in values for {CLIENT} and {SERVICE} in examples. */
export const SAMPLE_FIELDS = { CLIENT: "INT", SERVICE: "SVC" } as const;

/** Indian GST invoice numbers may be at most this long (CGST Rules, rule 46(b)). */
export const GST_NUMBER_MAX_LENGTH = 16;

/** The first number a scheme would issue today, with sample client and service. */
export function exampleNumber(
  scheme: { pattern: string; resetPolicy: string; fiscalYearStartMonth: number; startAt: number },
  ctx: Omit<NumberContext, "fields">,
) {
  return formatNumber(
    scheme as Parameters<typeof formatNumber>[0],
    { ...ctx, fields: SAMPLE_FIELDS },
    scheme.startAt,
    1,
  );
}

export async function listNumberingSchemes(
  actor: Actor,
  options: { includeArchived?: boolean } = {},
) {
  authorize(actor, "organisation.view");
  return db.numberingScheme.findMany({
    where: {
      ...(options.includeArchived ? {} : { status: "ACTIVE" }),
      ...entityFilter(actor, "organisation.view"),
    },
    include: { legalEntity: { select: { code: true } } },
    orderBy: [{ legalEntity: { code: "asc" } }, { documentType: "asc" }, { createdAt: "desc" }],
  });
}

/** What the next numbers would look like, without issuing one. */
export async function previewNumbers(actor: Actor, input: NumberingSchemeInput, date = new Date()) {
  const data = parseScheme(input);
  const entity = await getLegalEntity(actor, data.legalEntityId);
  const ctx = { entityCode: entity.code, date, timeZone: entity.timezone, fields: SAMPLE_FIELDS };
  return [0, 1, 2].map((i) => formatNumber(data, ctx, data.startAt + i, i + 1));
}

/** One scheme with its counters, newest period first. */
export async function getNumberingScheme(actor: Actor, id: string) {
  authorize(actor, "organisation.view");
  const scheme = await db.numberingScheme.findUnique({
    where: { id },
    include: {
      legalEntity: { select: { id: true, code: true, timezone: true, countryCode: true } },
      counters: { orderBy: [{ periodKey: "desc" }] },
    },
  });
  if (!scheme) throw new NotFoundError();
  await getLegalEntity(actor, scheme.legalEntityId);
  const tokens = patternTokens(scheme.pattern);
  return {
    ...scheme,
    label: DOCUMENT_TYPES[scheme.documentType as DocumentType]?.label ?? scheme.documentType,
    hasClientCount: tokens.has("CSEQ"),
    counters: scheme.counters.map((c) => {
      const [period, client] = c.periodKey.split("|");
      return { ...c, period: period!, clientCode: client ?? null };
    }),
  };
}

/**
 * Creates the active scheme for a document type in one entity. A scheme's
 * pattern and reset policy never change once created; to change the format,
 * archive it and create a new one (with `startAt` to carry the series on).
 */
export async function createNumberingScheme(actor: Actor, input: NumberingSchemeInput) {
  const data = parseScheme(input);
  await getLegalEntity(actor, data.legalEntityId);
  authorize(actor, "organisation.configure", { legalEntityId: data.legalEntityId });
  const label = DOCUMENT_TYPES[data.documentType as DocumentType].label;
  return withUniqueConflict(
    `This entity already has an active ${label.toLowerCase()} scheme. Archive it first.`,
    () =>
      db.$transaction(async (tx) => {
        const scheme = await tx.numberingScheme.create({ data });
        await recordAudit(tx, actor, {
          action: "numbering_scheme.created",
          targetType: "numbering_scheme",
          targetId: scheme.id,
          legalEntityId: scheme.legalEntityId,
          changes: diffChanges(null, scheme, SCHEME_FIELDS),
        });
        return scheme;
      }),
  );
}

export async function archiveNumberingScheme(actor: Actor, id: string, reason?: string) {
  const scheme = await db.numberingScheme.findUnique({ where: { id } });
  if (!scheme) throw new NotFoundError();
  await getLegalEntity(actor, scheme.legalEntityId);
  authorize(actor, "organisation.configure", { legalEntityId: scheme.legalEntityId });
  if (scheme.status === "ARCHIVED") return scheme;
  return db.$transaction(async (tx) => {
    const after = await tx.numberingScheme.update({ where: { id }, data: { status: "ARCHIVED" } });
    await recordAudit(tx, actor, {
      action: "numbering_scheme.archived",
      targetType: "numbering_scheme",
      targetId: id,
      legalEntityId: scheme.legalEntityId,
      changes: diffChanges(scheme, after, ["status"]),
      metadata: reason ? { reason } : undefined,
    });
    return after;
  });
}

/**
 * Archives a scheme and creates its successor for the same document type in
 * one step, so the entity is never left without a format. The new scheme's
 * counters start empty: set them to carry the series on.
 */
export async function replaceNumberingScheme(actor: Actor, id: string, input: ReplaceSchemeInput) {
  const old = await db.numberingScheme.findUnique({ where: { id } });
  if (!old) throw new NotFoundError();
  await getLegalEntity(actor, old.legalEntityId);
  authorize(actor, "organisation.configure", { legalEntityId: old.legalEntityId });
  if (old.status !== "ACTIVE") throw new ConflictError("This format is already archived.");
  const data = parseScheme({
    ...parseInput(replaceSchemeInput, input),
    documentType: old.documentType,
    legalEntityId: old.legalEntityId,
  });
  return withUniqueConflict("Another change replaced this format at the same time.", () =>
    db.$transaction(async (tx) => {
      const archived = await tx.numberingScheme.updateMany({
        where: { id, status: "ACTIVE" },
        data: { status: "ARCHIVED" },
      });
      if (!archived.count) throw new ConflictError("This format is already archived.");
      await recordAudit(tx, actor, {
        action: "numbering_scheme.archived",
        targetType: "numbering_scheme",
        targetId: id,
        legalEntityId: old.legalEntityId,
        changes: { status: { from: "ACTIVE", to: "ARCHIVED" } },
        metadata: { reason: "replaced" },
      });
      const scheme = await tx.numberingScheme.create({ data });
      await recordAudit(tx, actor, {
        action: "numbering_scheme.created",
        targetType: "numbering_scheme",
        targetId: scheme.id,
        legalEntityId: scheme.legalEntityId,
        changes: diffChanges(null, scheme, SCHEME_FIELDS),
        metadata: { replaces: id },
      });
      return scheme;
    }),
  );
}

/**
 * Carries on a series from another system: records the last number already
 * issued in a period, overall or for one client's {CSEQ} count. A count only
 * moves forward; lowering it would issue a number twice.
 */
export async function setNumberCounter(actor: Actor, schemeId: string, input: CounterInput) {
  const scheme = await db.numberingScheme.findUnique({
    where: { id: schemeId },
    include: { legalEntity: { select: { timezone: true } } },
  });
  if (!scheme) throw new NotFoundError();
  await getLegalEntity(actor, scheme.legalEntityId);
  authorize(actor, "organisation.configure", { legalEntityId: scheme.legalEntityId });
  if (scheme.status !== "ACTIVE") throw new ConflictError("This format is archived.");
  const data = parseInput(counterInput, input);
  if (data.clientCode && !patternTokens(scheme.pattern).has("CSEQ")) {
    throw new ValidationError("Check the highlighted fields.", {
      clientCode: ["This format has no per-client count."],
    });
  }
  const period = periodKey(scheme, { date: data.date!, timeZone: scheme.legalEntity.timezone });
  const key = data.clientCode ? `${period}|${data.clientCode}` : period;
  return db.$transaction(async (tx) => {
    const [current] = await tx.$queryRaw<{ lastValue: number }[]>`
      SELECT "lastValue" FROM number_counters
       WHERE "schemeId" = ${schemeId}::uuid AND "periodKey" = ${key} FOR UPDATE`;
    if (current && current.lastValue > data.lastValue) {
      throw new ConflictError(
        `Numbers up to ${current.lastValue} are already issued here. A count can only move forward.`,
      );
    }
    if (current?.lastValue === data.lastValue) return { periodKey: key, lastValue: data.lastValue };
    await tx.numberCounter.upsert({
      where: { schemeId_periodKey: { schemeId, periodKey: key } },
      create: { schemeId, periodKey: key, lastValue: data.lastValue },
      update: { lastValue: data.lastValue },
    });
    await recordAudit(tx, actor, {
      action: "numbering_counter.set",
      targetType: "numbering_scheme",
      targetId: schemeId,
      legalEntityId: scheme.legalEntityId,
      changes: { lastValue: { from: current?.lastValue ?? null, to: data.lastValue } },
      metadata: { periodKey: key },
    });
    return { periodKey: key, lastValue: data.lastValue };
  });
}

type Tx = Prisma.TransactionClient;

const MISSING_FIELD: Record<DocumentField, string> = {
  CLIENT: "This number format needs the client's invoice code.",
  SERVICE: "Choose the service before issuing: it is part of the number.",
};

/** Takes the next value of one counter row, which stays locked until the transaction ends. */
async function nextValue(tx: Tx, schemeId: string, key: string, first: number) {
  const [row] = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO number_counters ("schemeId", "periodKey", "lastValue", "updatedAt")
    VALUES (${schemeId}::uuid, ${key}, ${first}, now())
    ON CONFLICT ("schemeId", "periodKey")
    DO UPDATE SET "lastValue" = number_counters."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"`;
  return row!.lastValue;
}

/**
 * Issues the next number for a document. Call it inside the transaction that
 * saves the document: the counter row stays locked until that transaction
 * ends, concurrent callers queue behind it, and a rollback returns the number,
 * so a series has no gaps and no duplicates.
 */
export async function allocateNumber(
  tx: Tx,
  request: {
    documentType: DocumentType;
    legalEntityId: string;
    date?: Date;
    /** {CLIENT} and {SERVICE}, for formats that use them. */
    fields?: Partial<Record<DocumentField, string | null>>;
  },
): Promise<{ number: string; schemeId: string; sequence: number }> {
  const scheme = await tx.numberingScheme.findFirst({
    where: {
      documentType: request.documentType,
      legalEntityId: request.legalEntityId,
      status: "ACTIVE",
    },
    include: { legalEntity: { select: { code: true, timezone: true } } },
  });
  if (!scheme) {
    throw new ConflictError(
      `No active numbering scheme for ${DOCUMENT_TYPES[request.documentType].label.toLowerCase()} in this entity.`,
    );
  }
  const tokens = patternTokens(scheme.pattern);
  const fields: Partial<Record<DocumentField, string>> = {};
  for (const field of ["CLIENT", "SERVICE"] as const) {
    if (!tokens.has(field)) continue;
    const value = request.fields?.[field];
    if (!value) throw new ValidationError(MISSING_FIELD[field]);
    fields[field] = value;
  }
  const ctx = {
    entityCode: scheme.legalEntity.code,
    date: request.date ?? new Date(),
    timeZone: scheme.legalEntity.timezone,
    fields,
  };
  const key = periodKey(scheme, ctx);
  // Overall row first, then the client's, always in that order, so two
  // issuers can't deadlock on each other's rows.
  const sequence = await nextValue(tx, scheme.id, key, scheme.startAt);
  const clientSequence = tokens.has("CSEQ")
    ? await nextValue(tx, scheme.id, `${key}|${fields.CLIENT}`, 1)
    : undefined;
  return {
    number: formatNumber(scheme, ctx, sequence, clientSequence),
    schemeId: scheme.id,
    sequence,
  };
}

/** Adds the default format for each document type an entity has no active format for. */
export async function addDefaultNumberingSchemes(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "organisation.configure", { legalEntityId });
  return withUniqueConflict("Another change added formats at the same time. Try again.", () =>
    db.$transaction((tx) => addMissingDefaultSchemes(tx, actor, entity)),
  );
}
