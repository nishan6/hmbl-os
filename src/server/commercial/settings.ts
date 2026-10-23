import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import { NotFoundError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";

/** LABELLED DEFAULTS for an entity with no settings row (docs/decisions.md). */
export const COMMERCIAL_DEFAULTS = {
  requireQuoteApproval: false,
  approvalThresholdMinor: null as bigint | null,
  quoteValidityDays: 30,
};

export type CommercialSettingsView = typeof COMMERCIAL_DEFAULTS;

type Reader = Prisma.TransactionClient | typeof db;

export async function commercialSettingsFor(
  reader: Reader,
  legalEntityId: string,
): Promise<CommercialSettingsView> {
  const row = await reader.commercialSettings.findUnique({ where: { legalEntityId } });
  return row
    ? {
        requireQuoteApproval: row.requireQuoteApproval,
        approvalThresholdMinor: row.approvalThresholdMinor,
        quoteValidityDays: row.quoteValidityDays,
      }
    : { ...COMMERCIAL_DEFAULTS };
}

/** Settings for every entity the actor can see quotes in, for the admin screen. */
export async function listCommercialSettings(actor: Actor) {
  const entities = await db.legalEntity.findMany({
    where: { status: "ACTIVE" },
    orderBy: { code: "asc" },
    include: { commercial: true },
  });
  return entities
    .filter((e) => can(actor, "commercial.view", { legalEntityId: e.id }))
    .map((e) => ({
      entity: { id: e.id, code: e.code, legalName: e.legalName, baseCurrency: e.baseCurrency },
      canConfigure: can(actor, "commercial.configure", { legalEntityId: e.id }),
      settings: e.commercial
        ? {
            requireQuoteApproval: e.commercial.requireQuoteApproval,
            approvalThresholdMinor: e.commercial.approvalThresholdMinor,
            quoteValidityDays: e.commercial.quoteValidityDays,
          }
        : { ...COMMERCIAL_DEFAULTS },
    }));
}

const settingsInput = z.object({
  requireQuoteApproval: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  approvalThreshold: z.union([z.bigint(), z.string()]).nullish(),
  quoteValidityDays: z.coerce
    .number({ message: "Enter a number of days" })
    .int("Enter whole days")
    .min(1, "At least 1 day")
    .max(365, "At most 365 days"),
});
export type CommercialSettingsInput = z.input<typeof settingsInput>;

const FIELDS = ["requireQuoteApproval", "approvalThresholdMinor", "quoteValidityDays"] as const;

export async function updateCommercialSettings(
  actor: Actor,
  legalEntityId: string,
  raw: CommercialSettingsInput,
) {
  authorize(actor, "commercial.configure", { legalEntityId });
  const entity = await db.legalEntity.findUnique({ where: { id: legalEntityId } });
  if (!entity) throw new NotFoundError();
  const input = parseInput(
    settingsInput.transform((s, ctx) => {
      let approvalThresholdMinor: bigint | null = null;
      if (typeof s.approvalThreshold === "bigint") approvalThresholdMinor = s.approvalThreshold;
      else if (s.approvalThreshold?.trim()) {
        approvalThresholdMinor = parseMoneyToMinor(s.approvalThreshold, entity.baseCurrency);
        if (approvalThresholdMinor === null || approvalThresholdMinor < 0n) {
          ctx.addIssue({
            code: "custom",
            path: ["approvalThreshold"],
            message: "Enter an amount, e.g. 500000, or leave blank",
          });
          return z.NEVER;
        }
      }
      return {
        requireQuoteApproval: s.requireQuoteApproval,
        approvalThresholdMinor,
        quoteValidityDays: s.quoteValidityDays,
      };
    }),
    raw,
  );
  return db.$transaction(async (tx) => {
    const before = await commercialSettingsFor(tx, legalEntityId);
    const after = await tx.commercialSettings.upsert({
      where: { legalEntityId },
      create: { legalEntityId, ...input },
      update: input,
    });
    const changes = diffChanges(before, after, FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "commercial_settings.updated",
        targetType: "legal_entity",
        targetId: legalEntityId,
        legalEntityId,
        changes,
      });
    }
    return after;
  });
}
