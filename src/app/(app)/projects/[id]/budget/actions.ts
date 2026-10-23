"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import {
  closeCommitment,
  deleteDraftBudgetLine,
  recordCostEntry,
  saveDraftBudgetLine,
  setLineCostCode,
  setLineForecast,
  voidCostEntry,
} from "@/server/projects/budget";

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

export async function saveDraftLineAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      saveDraftBudgetLine(await requireActor(), projectId, {
        lineId: v.lineId,
        section: v.section,
        category: (v.category ?? "") as "OTHER",
        costCodeId: v.costCodeId,
        description: v.description ?? "",
        quantity: v.quantity,
        days: v.days,
        unitCode: v.unitCode,
        cost: v.cost,
        revenue: v.revenue,
      }),
    "Budget line saved",
  );
}

export async function deleteDraftLineAction(projectId: string, _: FormState, formData: FormData) {
  return run(formData, async ({ lineId = "" }) =>
    deleteDraftBudgetLine(await requireActor(), projectId, lineId),
  );
}

export async function lineSettingsAction(lineId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => {
      const actor = await requireActor();
      await setLineCostCode(actor, lineId, v.costCodeId || null);
      return setLineForecast(actor, lineId, { forecast: v.forecast, note: v.note });
    },
    "Line saved",
  );
}

export async function recordCostAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      recordCostEntry(await requireActor(), projectId, {
        budgetLineId: v.budgetLineId ?? "",
        kind: (v.kind ?? "") as "ACTUAL",
        amount: v.amount,
        entryDate: v.entryDate,
        description: v.description ?? "",
        supplier: v.supplier,
        reference: v.reference,
        commitmentId: v.commitmentId,
      }),
    "Cost recorded",
  );
}

export async function costEntryCommandAction(_: FormState, formData: FormData) {
  return run(formData, async ({ entryId = "", command, reason }) => {
    const actor = await requireActor();
    if (command === "close") return closeCommitment(actor, entryId);
    return voidCostEntry(actor, entryId, { reason });
  });
}
