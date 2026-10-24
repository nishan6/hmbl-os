import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { AcceptanceMethod } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { checkTransition } from "@/server/crm/transitions";
import { moveWithin } from "@/server/crm/pipeline";
import { createProjectFromVersion } from "@/server/projects/conversion";
import { ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { auditStatus, loadQuote, lockLatest } from "./workflow";
import { localToday } from "./quotes";

export const ACCEPTANCE_METHODS = {
  SIGNED_QUOTE: "Signed quote",
  EMAIL: "Email",
  PURCHASE_ORDER: "Purchase order",
  OTHER: "Other",
} as const;

/** Every way an acceptance can be recorded, including by the client in the portal. */
export const ACCEPTANCE_METHOD_LABELS: Record<AcceptanceMethod, string> = {
  ...ACCEPTANCE_METHODS,
  PORTAL: "Client portal",
};

const acceptInput = z.object({
  acceptedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
    .transform((v) => new Date(`${v}T00:00:00Z`)),
  acceptedByName: requiredText(200),
  acceptanceMethod: z.enum(Object.keys(ACCEPTANCE_METHODS) as [keyof typeof ACCEPTANCE_METHODS], {
    error: "Choose how the client accepted",
  }),
  clientPoNumber: optionalText(100),
  acceptanceNotes: optionalText(2000),
});

const declineInput = z.object({ reason: requiredText(1000) });

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields", { [field]: [message] });

/**
 * Records the client's acceptance of the issued version and, in the same
 * transaction, creates the project, marks the opportunity won and makes a
 * prospect a client. Recording the answer is a commercial step
 * (`commercial.edit`); the project follows from it (docs/decisions.md).
 */
export async function acceptQuote(actor: Actor, quoteId: string, raw: unknown) {
  const quote = await loadQuote(actor, quoteId);
  authorize(actor, "commercial.edit", { legalEntityId: quote.legalEntityId });
  const input = parseInput(acceptInput, raw);
  if (input.acceptedOn > localToday(quote.legalEntity.timezone)) {
    throw invalid("acceptedOn", "The acceptance date can't be in the future");
  }

  return db.$transaction(async (tx) => {
    const version = await lockLatest(tx, quote, ["ISSUED"]);
    if (
      version.issuedAt &&
      input.acceptedOn < localToday(quote.legalEntity.timezone, version.issuedAt)
    ) {
      throw invalid("acceptedOn", "The quote was issued after that date");
    }
    if (
      (version.poRequired || input.acceptanceMethod === "PURCHASE_ORDER") &&
      !input.clientPoNumber
    ) {
      throw invalid("clientPoNumber", "This quote needs the client's PO number");
    }
    return recordAcceptance(tx, actor, quote, version, input);
  });
}

type AcceptanceInput = {
  acceptedOn: Date;
  acceptedByName: string;
  acceptanceMethod: AcceptanceMethod;
  clientPoNumber: string | null;
  acceptanceNotes: string | null;
};

/**
 * The acceptance itself, inside the caller's transaction, on a version the
 * caller has locked and checked is ISSUED. Shared by staff recording an
 * answer and by the client accepting in the portal, so both create the
 * project, win the opportunity and make a prospect a client the same way.
 */
export async function recordAcceptance(
  tx: Prisma.TransactionClient,
  actor: Actor,
  quote: Awaited<ReturnType<typeof loadQuote>>,
  version: Awaited<ReturnType<typeof lockLatest>>,
  input: AcceptanceInput,
  options: { projectCreatedById?: string; audit?: Record<string, unknown> } = {},
) {
  const now = new Date();
  await tx.quoteVersion.update({
    where: { id: version.id },
    data: {
      status: "ACCEPTED",
      acceptedOn: input.acceptedOn,
      acceptedByName: input.acceptedByName,
      acceptanceMethod: input.acceptanceMethod,
      clientPoNumber: input.clientPoNumber,
      acceptanceNotes: input.acceptanceNotes,
      answerRecordedAt: now,
      answerRecordedById: actor.id,
    },
  });
  await auditStatus(tx, actor, quote, "quote.accepted", version, "ACCEPTED", {
    acceptedOn: input.acceptedOn.toISOString().slice(0, 10),
    acceptedByName: input.acceptedByName,
    method: input.acceptanceMethod,
    clientPoNumber: input.clientPoNumber,
    afterValidity: input.acceptedOn > version.validUntil,
    ...options.audit,
  });

  const project = await createProjectFromVersion(tx, actor, quote, version, input, {
    createdById: options.projectCreatedById,
  });

  if (quote.opportunityId) {
    const opportunity = await tx.opportunity.findUniqueOrThrow({
      where: { id: quote.opportunityId },
      include: { stage: true },
    });
    const won = await tx.pipelineStage.findFirst({
      where: { kind: "WON", status: "ACTIVE" },
      orderBy: { position: "asc" },
    });
    if (won && opportunity.stage.kind !== "WON") {
      const reason = `Quote ${quote.number} accepted`;
      const check = checkTransition(opportunity.stage, won, reason);
      if (check.ok) await moveWithin(tx, actor, opportunity, won, reason, check);
    }
  }

  const client = await tx.client.findUniqueOrThrow({ where: { id: quote.clientId } });
  if (client.relationship === "PROSPECT") {
    await tx.client.update({ where: { id: client.id }, data: { relationship: "CLIENT" } });
    await recordAudit(tx, actor, {
      action: "client.updated",
      targetType: "client",
      targetId: client.id,
      changes: { relationship: { from: "PROSPECT", to: "CLIENT" } },
      metadata: { reason: `Quote ${quote.number} accepted` },
    });
  }
  return project;
}

/** Records that the client turned the issued version down. */
export async function declineQuote(actor: Actor, quoteId: string, raw: unknown) {
  const quote = await loadQuote(actor, quoteId);
  authorize(actor, "commercial.edit", { legalEntityId: quote.legalEntityId });
  const { reason } = parseInput(declineInput, raw);
  return db.$transaction(async (tx) => {
    const version = await lockLatest(tx, quote, ["ISSUED"]);
    return recordDecline(tx, actor, quote, version, reason);
  });
}

/** The decline itself, inside the caller's transaction, on a locked ISSUED version. */
export async function recordDecline(
  tx: Prisma.TransactionClient,
  actor: Actor,
  quote: { id: string; legalEntityId: string },
  version: Awaited<ReturnType<typeof lockLatest>>,
  reason: string,
  audit: Record<string, unknown> = {},
) {
  const now = new Date();
  const after = await tx.quoteVersion.update({
    where: { id: version.id },
    data: {
      status: "DECLINED",
      declinedAt: now,
      statusReason: reason,
      answerRecordedAt: now,
      answerRecordedById: actor.id,
    },
  });
  await auditStatus(tx, actor, quote, "quote.declined", version, "DECLINED", {
    reason,
    ...audit,
  });
  return after;
}
