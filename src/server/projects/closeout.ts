import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { ConflictError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { optionalText } from "@/lib/validation";
import { closeoutBlockers } from "./closeout-checks";
import { CLOSEOUT_ITEMS, outstandingCloseout, type CloseoutKey } from "./closeout-rules";
import { isPreApproval } from "./lifecycle";
import { assertChangeable, loadProject, lockProject } from "./projects";

type Reader = Prisma.TransactionClient | typeof db;

const keys = CLOSEOUT_ITEMS.map((i) => i.key) as [CloseoutKey, ...CloseoutKey[]];

const itemInput = z.object({
  key: z.enum(keys),
  state: z.enum(["done", "not_applicable", "open"]),
  note: optionalText(1000),
});
export type CloseoutItemInput = z.input<typeof itemInput>;

/** Whether the project has a current closeout report on file. */
async function hasFinalReport(reader: Reader, projectId: string) {
  const report = await reader.projectDocument.findFirst({
    where: { projectId, category: "CLOSEOUT_REPORT", supersededAt: null, archivedAt: null },
    select: { id: true },
  });
  return report !== null;
}

export async function getCloseout(actor: Actor, projectId: string) {
  await loadProject(actor, projectId);
  const [rows, finalReport, blockers] = await Promise.all([
    db.projectCloseoutItem.findMany({ where: { projectId } }),
    hasFinalReport(db, projectId),
    closeoutBlockers(db, projectId),
  ]);
  const blocked = Object.keys(blockers) as CloseoutKey[];
  return {
    finalReport,
    outstanding: outstandingCloseout(rows, blocked).map((i) => i.key),
    items: CLOSEOUT_ITEMS.map((item) => ({
      ...item,
      row: rows.find((r) => r.key === item.key) ?? null,
      blockers: blockers[item.key] ?? [],
    })),
  };
}

/** Ticks a closeout item off, marks it not applicable (with a note), or reopens it. */
export async function setCloseoutItem(actor: Actor, projectId: string, raw: CloseoutItemInput) {
  const project = await loadProject(actor, projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  const { key, state, note } = parseInput(itemInput, raw);
  if (state === "not_applicable" && !note) {
    throw new ValidationError("Check the highlighted fields.", {
      note: ["Say why it doesn't apply"],
    });
  }
  return db.$transaction(async (tx) => {
    const current = await lockProject(tx, projectId);
    assertChangeable(current);
    if (isPreApproval(current.status)) {
      throw new ConflictError("Closeout starts once the project is approved.");
    }
    if (key === "FINAL_REPORT" && state === "done" && !(await hasFinalReport(tx, projectId))) {
      throw new ConflictError("Upload the closeout report under Documents first.");
    }
    if (state !== "open") {
      const blockers = (await closeoutBlockers(tx, projectId))[key];
      if (blockers?.length) {
        throw new ConflictError(
          `The records show this isn't finished: ${blockers[0]!.text}${blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ""}`,
        );
      }
    }
    const data = {
      doneAt: state === "done" ? new Date() : null,
      notApplicable: state === "not_applicable",
      note,
      updatedById: actor.id,
      updatedByLabel: actor.name,
    };
    const row = await tx.projectCloseoutItem.upsert({
      where: { projectId_key: { projectId, key } },
      create: { projectId, key, ...data },
      update: data,
    });
    await recordAudit(tx, actor, {
      action: "closeout.item_updated",
      targetType: "project",
      targetId: projectId,
      legalEntityId: project.legalEntityId,
      metadata: { key, state, note },
    });
    return row;
  });
}
