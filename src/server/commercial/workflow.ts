import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { minorUnitDigits } from "@/lib/format";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { commercialSettingsFor, type CommercialSettingsView } from "./settings";
import { localToday } from "./quotes";

/*
 * The life of a quote version after drafting:
 *
 *   DRAFT ──submit──▶ PENDING_APPROVAL ──approve──▶ APPROVED ──issue──▶ ISSUED
 *     ▲                     │reject                                     │
 *     └─────────────────────┘                                           ├─ revise ─▶ new DRAFT version
 *   DRAFT ──issue──▶ ISSUED     (when the entity doesn't require approval)
 *   PENDING_APPROVAL / APPROVED / ISSUED ──withdraw──▶ WITHDRAWN
 *
 * Acceptance and decline come with conversion into projects. Every step
 * locks the version row, checks the status it expects, and is audited.
 */

type Tx = Prisma.TransactionClient;
type Status = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ISSUED" | "DECLINED" | "WITHDRAWN";

const commentInput = z.object({ comment: optionalText(1000) });
const reasonInput = z.object({ comment: requiredText(1000) });

/** The quote's base-currency value, for the approval threshold. */
export function baseValueMinor(
  totalMinor: bigint,
  currency: string,
  baseCurrency: string,
  fxRateToBase: Prisma.Decimal | string | null,
): bigint | null {
  if (currency === baseCurrency) return totalMinor;
  if (fxRateToBase === null) return null;
  const shift = minorUnitDigits(baseCurrency) - minorUnitDigits(currency);
  const value = new Prisma.Decimal(totalMinor.toString())
    .mul(fxRateToBase)
    .mul(new Prisma.Decimal(10).pow(shift));
  return BigInt(value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0));
}

/** Does this version need the Director's approval before it is issued? */
export function needsApproval(
  settings: CommercialSettingsView,
  version: { totalMinor: bigint; currency: string; fxRateToBase: Prisma.Decimal | null },
  baseCurrency: string,
) {
  if (!settings.requireQuoteApproval) return false;
  if (settings.approvalThresholdMinor === null) return true;
  const value = baseValueMinor(
    version.totalMinor,
    version.currency,
    baseCurrency,
    version.fxRateToBase,
  );
  // Without a rate the value is unknown, so it can't be shown to be under the limit.
  return value === null || value >= settings.approvalThresholdMinor;
}

/** What stops a version going to the client. Empty when it's ready. */
export function readinessIssues(
  version: {
    totalMinor: bigint;
    currency: string;
    fxRateToBase: Prisma.Decimal | null;
    validUntil: Date;
    _count: { lines: number };
  },
  entity: { baseCurrency: string; timezone: string },
): string[] {
  const issues: string[] = [];
  if (!version._count.lines) issues.push("Add at least one line.");
  else if (version.totalMinor <= 0n) issues.push("The total must be above zero.");
  if (version.currency !== entity.baseCurrency && !version.fxRateToBase) {
    issues.push(`Enter the exchange rate to ${entity.baseCurrency}.`);
  }
  if (version.validUntil < localToday(entity.timezone)) {
    issues.push("The validity date has passed. Choose a later one.");
  }
  return issues;
}

async function load(actor: Actor, quoteId: string) {
  const quote = await db.quote.findUnique({
    where: { id: quoteId },
    include: { legalEntity: true },
  });
  if (!quote || !can(actor, "commercial.view", { legalEntityId: quote.legalEntityId })) {
    throw new NotFoundError();
  }
  return quote;
}

/** Locks the latest version and checks it is in one of `from`. */
async function lockLatest(tx: Tx, quote: { id: string; currentVersion: number }, from: Status[]) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM quote_versions
    WHERE "quoteId" = ${quote.id}::uuid AND version = ${quote.currentVersion}
    FOR UPDATE`;
  if (!row) throw new NotFoundError();
  const version = await tx.quoteVersion.findUniqueOrThrow({
    where: { id: row.id },
    include: { _count: { select: { lines: true } } },
  });
  if (!from.includes(version.status as Status)) {
    throw new ConflictError(
      `This quote is ${STATUS_WORDS[version.status]}, so that isn't possible now.`,
    );
  }
  return version;
}

const STATUS_WORDS: Record<string, string> = {
  DRAFT: "a draft",
  PENDING_APPROVAL: "waiting for approval",
  APPROVED: "approved",
  ISSUED: "issued",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  SUPERSEDED: "superseded",
  WITHDRAWN: "withdrawn",
};

function assertReady(issues: string[]) {
  if (issues.length) throw new ValidationError(`Not ready to send: ${issues.join(" ")}`);
}

async function step(
  tx: Tx,
  actor: Actor,
  version: { id: string; totalMinor: bigint; marginBps: number | null },
  action: "SUBMITTED" | "APPROVED" | "REJECTED",
  comment: string | null,
  selfApproval = false,
) {
  await tx.quoteApprovalStep.create({
    data: {
      versionId: version.id,
      action,
      actorId: actor.id,
      actorLabel: actor.name,
      comment,
      selfApproval,
      totalMinor: version.totalMinor,
      marginBps: version.marginBps,
    },
  });
}

async function audit(
  tx: Tx,
  actor: Actor,
  quote: { id: string; legalEntityId: string },
  action: string,
  version: { version: number; status: string },
  to: string,
  metadata: Record<string, unknown> = {},
) {
  await recordAudit(tx, actor, {
    action,
    targetType: "quote",
    targetId: quote.id,
    legalEntityId: quote.legalEntityId,
    changes: { status: { from: version.status, to } },
    metadata: { version: version.version, ...metadata },
  });
}

function guard(actor: Actor, permission: Permission, legalEntityId: string) {
  authorize(actor, permission, { legalEntityId });
}

// ─── Steps ───────────────────────────────────────────────────────────────────

/** Sends a draft to the Director. Only for entities that require approval. */
export async function submitQuote(actor: Actor, quoteId: string, raw: unknown = {}) {
  const quote = await load(actor, quoteId);
  guard(actor, "commercial.submit", quote.legalEntityId);
  const { comment } = parseInput(commentInput, raw);
  const settings = await commercialSettingsFor(db, quote.legalEntityId);
  return db.$transaction(async (tx) => {
    const version = await lockLatest(tx, quote, ["DRAFT"]);
    assertReady(readinessIssues(version, quote.legalEntity));
    if (!needsApproval(settings, version, quote.legalEntity.baseCurrency)) {
      throw new ConflictError("This quote doesn't need approval. Issue it directly.");
    }
    const after = await tx.quoteVersion.update({
      where: { id: version.id },
      data: { status: "PENDING_APPROVAL", submittedAt: new Date() },
    });
    await step(tx, actor, version, "SUBMITTED", comment);
    await audit(tx, actor, quote, "quote.submitted", version, "PENDING_APPROVAL");
    return after;
  });
}

export async function approveQuote(actor: Actor, quoteId: string, raw: unknown = {}) {
  const quote = await load(actor, quoteId);
  guard(actor, "commercial.approve", quote.legalEntityId);
  const { comment } = parseInput(commentInput, raw);
  return db.$transaction(async (tx) => {
    const version = await lockLatest(tx, quote, ["PENDING_APPROVAL"]);
    const submitted = await tx.quoteApprovalStep.findFirst({
      where: { versionId: version.id, action: "SUBMITTED" },
      orderBy: { at: "desc" },
    });
    // Allowed (a Director may price their own quote) but recorded.
    const selfApproval = submitted?.actorId === actor.id;
    const after = await tx.quoteVersion.update({
      where: { id: version.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: actor.id },
    });
    await step(tx, actor, version, "APPROVED", comment, selfApproval);
    await audit(tx, actor, quote, "quote.approved", version, "APPROVED", {
      selfApproval,
      totalMinor: version.totalMinor.toString(),
      marginBps: version.marginBps,
    });
    return after;
  });
}

/** Sends it back to draft with the reason, for the salesperson to change. */
export async function rejectQuote(actor: Actor, quoteId: string, raw: unknown) {
  const quote = await load(actor, quoteId);
  guard(actor, "commercial.reject", quote.legalEntityId);
  const { comment } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    const version = await lockLatest(tx, quote, ["PENDING_APPROVAL"]);
    const after = await tx.quoteVersion.update({
      where: { id: version.id },
      data: { status: "DRAFT", submittedAt: null },
    });
    await step(tx, actor, version, "REJECTED", comment);
    await audit(tx, actor, quote, "quote.rejected", version, "DRAFT", { reason: comment });
    return after;
  });
}

/** Marks the version as sent to the client. Its content is frozen from now on. */
export async function issueQuote(actor: Actor, quoteId: string) {
  const quote = await load(actor, quoteId);
  guard(actor, "commercial.issue", quote.legalEntityId);
  const settings = await commercialSettingsFor(db, quote.legalEntityId);
  return db.$transaction(async (tx) => {
    const version = await lockLatest(tx, quote, ["DRAFT", "APPROVED"]);
    assertReady(readinessIssues(version, quote.legalEntity));
    if (
      version.status === "DRAFT" &&
      needsApproval(settings, version, quote.legalEntity.baseCurrency)
    ) {
      throw new ConflictError(
        "This quote needs the Director's approval first. Submit it for approval.",
      );
    }
    const after = await tx.quoteVersion.update({
      where: { id: version.id },
      data: { status: "ISSUED", issuedAt: new Date(), issuedById: actor.id },
    });
    await audit(tx, actor, quote, "quote.issued", version, "ISSUED");
    return after;
  });
}

/** Withdraws a quote that's waiting, approved or with the client. */
export async function withdrawQuote(actor: Actor, quoteId: string, raw: unknown) {
  const quote = await load(actor, quoteId);
  guard(actor, "commercial.edit", quote.legalEntityId);
  const { comment } = parseInput(reasonInput, raw);
  return db.$transaction(async (tx) => {
    const version = await lockLatest(tx, quote, ["PENDING_APPROVAL", "APPROVED", "ISSUED"]);
    const after = await tx.quoteVersion.update({
      where: { id: version.id },
      data: { status: "WITHDRAWN", withdrawnAt: new Date(), statusReason: comment },
    });
    await audit(tx, actor, quote, "quote.withdrawn", version, "WITHDRAWN", { reason: comment });
    return after;
  });
}

const COPIED = [
  "contactId",
  "currency",
  "fxRateToBase",
  "fxNote",
  "paymentTermId",
  "paymentTermName",
  "taxRateId",
  "taxRateBps",
  "contingencyBps",
  "poRequired",
  "eventStartDate",
  "eventEndDate",
  "venue",
  "scope",
  "deliverables",
  "exclusions",
  "terms",
  "internalNotes",
  "subtotalMinor",
  "discountMinor",
  "contingencyMinor",
  "taxMinor",
  "totalMinor",
  "costMinor",
  "marginBps",
] as const;

/**
 * Starts the next version as a draft copy of the latest one, with a fresh
 * validity. An approved or issued version it replaces becomes superseded;
 * the history keeps every version as it was.
 */
export async function reviseQuote(actor: Actor, quoteId: string) {
  const quote = await load(actor, quoteId);
  guard(actor, "commercial.edit", quote.legalEntityId);
  const settings = await commercialSettingsFor(db, quote.legalEntityId);
  return db.$transaction(async (tx) => {
    const latest = await lockLatest(tx, quote, ["APPROVED", "ISSUED", "DECLINED", "WITHDRAWN"]);
    const lines = await tx.quoteLine.findMany({
      where: { versionId: latest.id },
      orderBy: { position: "asc" },
    });
    const number = latest.version + 1;
    const copy = Object.fromEntries(COPIED.map((f) => [f, latest[f]])) as Pick<
      typeof latest,
      (typeof COPIED)[number]
    >;
    const next = await tx.quoteVersion.create({
      data: {
        ...copy,
        fxRateToBase: latest.fxRateToBase,
        paymentSchedule: latest.paymentSchedule as Prisma.InputJsonValue,
        quoteId: quote.id,
        version: number,
        validUntil: new Date(
          localToday(quote.legalEntity.timezone).getTime() +
            settings.quoteValidityDays * 86_400_000,
        ),
        createdById: actor.id,
      },
    });
    await tx.quoteLine.createMany({
      data: lines.map(({ id: _id, versionId: _v, ...line }) => {
        void _id;
        void _v;
        return { ...line, versionId: next.id };
      }),
    });
    if (latest.status === "APPROVED" || latest.status === "ISSUED") {
      await tx.quoteVersion.update({
        where: { id: latest.id },
        data: { status: "SUPERSEDED", statusReason: `Replaced by version ${number}` },
      });
    }
    await tx.quote.update({ where: { id: quote.id }, data: { currentVersion: number } });
    await recordAudit(tx, actor, {
      action: "quote.revised",
      targetType: "quote",
      targetId: quote.id,
      legalEntityId: quote.legalEntityId,
      changes: { currentVersion: { from: latest.version, to: number } },
      metadata: { previousStatus: latest.status },
    });
    return next;
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** What the actor may do with the latest version now, for the quote page. */
export async function availableActions(actor: Actor, quoteId: string) {
  const quote = await load(actor, quoteId);
  const scope = { legalEntityId: quote.legalEntityId };
  const [version, settings] = await Promise.all([
    db.quoteVersion.findUniqueOrThrow({
      where: { quoteId_version: { quoteId, version: quote.currentVersion } },
      include: { _count: { select: { lines: true } } },
    }),
    commercialSettingsFor(db, quote.legalEntityId),
  ]);
  const status = version.status;
  const approval = needsApproval(settings, version, quote.legalEntity.baseCurrency);
  return {
    needsApproval: approval,
    issues: readinessIssues(version, quote.legalEntity),
    submit: status === "DRAFT" && approval && can(actor, "commercial.submit", scope),
    approve: status === "PENDING_APPROVAL" && can(actor, "commercial.approve", scope),
    reject: status === "PENDING_APPROVAL" && can(actor, "commercial.reject", scope),
    issue:
      (status === "APPROVED" || (status === "DRAFT" && !approval)) &&
      can(actor, "commercial.issue", scope),
    revise:
      ["APPROVED", "ISSUED", "DECLINED", "WITHDRAWN"].includes(status) &&
      can(actor, "commercial.edit", scope),
    withdraw:
      ["PENDING_APPROVAL", "APPROVED", "ISSUED"].includes(status) &&
      can(actor, "commercial.edit", scope),
  };
}

export async function listApprovalSteps(actor: Actor, quoteId: string) {
  const quote = await load(actor, quoteId);
  return db.quoteApprovalStep.findMany({
    where: { version: { quoteId: quote.id } },
    include: { version: { select: { version: true } } },
    orderBy: { at: "desc" },
  });
}

/** Quotes waiting for this actor's approval, oldest first. */
export async function listPendingApprovals(actor: Actor) {
  if (!can(actor, "commercial.approve")) return [];
  return db.quoteVersion.findMany({
    where: {
      status: "PENDING_APPROVAL",
      quote: entityFilter(actor, "commercial.approve"),
    },
    include: { quote: { include: { client: { select: { name: true } } } } },
    orderBy: { submittedAt: "asc" },
    take: 50,
  });
}
