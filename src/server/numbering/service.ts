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
import { DOCUMENT_TYPES, type DocumentType } from "./document-types";
import { addMissingDefaultSchemes } from "./defaults";
import { formatNumber, periodKey, validatePattern } from "./pattern";
import { numberingSchemeInput, type NumberingSchemeInput } from "./schemas";

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
  const problems = validatePattern(data);
  if (problems.length) throw new ValidationError(problems[0]!, { pattern: problems });
  return data;
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
  const ctx = { entityCode: entity.code, date, timeZone: entity.timezone };
  return [0, 1, 2].map((i) => formatNumber(data, ctx, data.startAt + i));
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

type Tx = Prisma.TransactionClient;

/**
 * Issues the next number for a document. Call it inside the transaction that
 * saves the document: the counter row stays locked until that transaction
 * ends, concurrent callers queue behind it, and a rollback returns the number,
 * so a series has no gaps and no duplicates.
 */
export async function allocateNumber(
  tx: Tx,
  request: { documentType: DocumentType; legalEntityId: string; date?: Date },
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
  const ctx = {
    entityCode: scheme.legalEntity.code,
    date: request.date ?? new Date(),
    timeZone: scheme.legalEntity.timezone,
  };
  const key = periodKey(scheme, ctx);
  const [row] = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO number_counters ("schemeId", "periodKey", "lastValue", "updatedAt")
    VALUES (${scheme.id}::uuid, ${key}, ${scheme.startAt}, now())
    ON CONFLICT ("schemeId", "periodKey")
    DO UPDATE SET "lastValue" = number_counters."lastValue" + 1, "updatedAt" = now()
    RETURNING "lastValue"`;
  const sequence = row!.lastValue;
  return { number: formatNumber(scheme, ctx, sequence), schemeId: scheme.id, sequence };
}

/** Adds the default format for each document type an entity has no active format for. */
export async function addDefaultNumberingSchemes(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "organisation.configure", { legalEntityId });
  return withUniqueConflict("Another change added formats at the same time. Try again.", () =>
    db.$transaction((tx) => addMissingDefaultSchemes(tx, actor, entity)),
  );
}
