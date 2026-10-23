"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import {
  deleteRequirement,
  saveRequirement,
  type RequirementInput,
} from "@/server/projects/resources";

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

export async function saveRequirementAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      saveRequirement(await requireActor(), projectId, {
        requirementId: v.requirementId,
        kind: (v.kind ?? "") as RequirementInput["kind"],
        name: v.name ?? "",
        quantity: v.quantity ?? "",
        startDate: v.startDate,
        endDate: v.endDate,
        budgetLineId: v.budgetLineId,
        dayRate: v.dayRate,
        notes: v.notes,
      }),
    "Plan saved",
  );
}

export async function deleteRequirementAction(_: FormState, formData: FormData) {
  return run(formData, async ({ requirementId = "" }) =>
    deleteRequirement(await requireActor(), requirementId),
  );
}
