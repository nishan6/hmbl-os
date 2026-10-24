import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { ValidationError } from "@/lib/errors";

type Reader = Pick<Prisma.TransactionClient, "procurementSettings">;

/**
 * An entity's purchasing rules. DEFAULT: with no row, the threshold is zero,
 * so every order needs approval until someone with `procurement.configure`
 * sets one (docs/decisions.md, "Purchase order approval").
 */
export async function procurementSettingsOf(client: Reader, legalEntityId: string) {
  const row = await client.procurementSettings.findUnique({ where: { legalEntityId } });
  return row ?? { legalEntityId, approvalThresholdMinor: 0n, updatedAt: null };
}

/** An entity's purchasing rules, with the entity's code, name and base currency. */
export async function getProcurementSettings(actor: Actor, legalEntityId: string) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "procurement.view", { legalEntityId });
  return { entity, settings: await procurementSettingsOf(db, legalEntityId) };
}

const settingsInput = z.object({
  approvalThreshold: z.string().trim().min(1, "Enter an amount, or 0 to approve every order"),
});
export type ProcurementSettingsInput = z.input<typeof settingsInput>;

export async function updateProcurementSettings(
  actor: Actor,
  legalEntityId: string,
  raw: ProcurementSettingsInput,
) {
  const entity = await getLegalEntity(actor, legalEntityId);
  authorize(actor, "procurement.configure", { legalEntityId });
  const { approvalThreshold } = parseInput(settingsInput, raw);
  const approvalThresholdMinor = parseMoneyToMinor(approvalThreshold, entity.baseCurrency);
  if (approvalThresholdMinor === null || approvalThresholdMinor < 0n) {
    throw new ValidationError("Check the highlighted fields.", {
      approvalThreshold: ["Enter an amount of zero or more"],
    });
  }
  return db.$transaction(async (tx) => {
    const before = await procurementSettingsOf(tx, legalEntityId);
    const after = await tx.procurementSettings.upsert({
      where: { legalEntityId },
      create: { legalEntityId, approvalThresholdMinor },
      update: { approvalThresholdMinor },
    });
    if (before.approvalThresholdMinor !== approvalThresholdMinor) {
      await recordAudit(tx, actor, {
        action: "procurement_settings.updated",
        targetType: "legal_entity",
        targetId: legalEntityId,
        legalEntityId,
        changes: {
          approvalThresholdMinor: {
            from: before.approvalThresholdMinor.toString(),
            to: approvalThresholdMinor.toString(),
          },
        },
      });
    }
    return after;
  });
}
