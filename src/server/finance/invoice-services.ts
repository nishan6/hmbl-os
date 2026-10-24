import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { getLegalEntity } from "@/server/organisation/service";
import { NotFoundError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { numberCodeSchema, requiredText } from "@/lib/validation";

/*
 * What an entity sells, as coded in its invoice numbers ({SERVICE}): VLR for
 * rentals, LDS for live design. A code is printed in issued numbers, so it
 * never changes; archive a service to stop offering it.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");

const createInput = z.object({ code: numberCodeSchema, name: requiredText(80) });
const updateInput = z.object({ name: requiredText(80), archived: booleanish });
export type InvoiceServiceInput = z.input<typeof createInput>;
export type InvoiceServiceUpdate = z.input<typeof updateInput>;

export async function listInvoiceServices(
  actor: Actor,
  legalEntityId: string,
  options: { includeArchived?: boolean } = {},
) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.view", { legalEntityId });
  return db.invoiceService.findMany({
    where: { legalEntityId, ...(options.includeArchived ? {} : { status: "ACTIVE" }) },
    orderBy: [{ status: "asc" }, { code: "asc" }],
  });
}

export async function createInvoiceService(
  actor: Actor,
  legalEntityId: string,
  raw: InvoiceServiceInput,
) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "finance.configure", { legalEntityId });
  const data = parseInput(createInput, raw);
  return withUniqueConflict(`This company already has a service ${data.code}.`, () =>
    db.$transaction(async (tx) => {
      const service = await tx.invoiceService.create({ data: { legalEntityId, ...data } });
      await recordAudit(tx, actor, {
        action: "invoice_service.created",
        targetType: "invoice_service",
        targetId: service.id,
        legalEntityId,
        changes: diffChanges(null, service, ["code", "name"]),
      });
      return service;
    }),
  );
}

/** Renames or archives a service. Its code stays. */
export async function updateInvoiceService(actor: Actor, id: string, raw: InvoiceServiceUpdate) {
  const before = await db.invoiceService.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  await getLegalEntity(actor, before.legalEntityId);
  authorize(actor, "finance.configure", { legalEntityId: before.legalEntityId });
  const { name, archived } = parseInput(updateInput, raw);
  return db.$transaction(async (tx) => {
    const after = await tx.invoiceService.update({
      where: { id },
      data: { name, status: archived ? "ARCHIVED" : "ACTIVE" },
    });
    const changes = diffChanges(before, after, ["name", "status"]);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "invoice_service.updated",
        targetType: "invoice_service",
        targetId: id,
        legalEntityId: after.legalEntityId,
        changes,
      });
    }
    return after;
  });
}
