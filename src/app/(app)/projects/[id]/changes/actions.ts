"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  approveChangeOrder,
  createChangeOrder,
  recordClientApproval,
  rejectChangeOrder,
  removeChangeOrderLine,
  saveChangeOrderLine,
  submitChangeOrder,
  updateChangeOrder,
  withdrawChangeOrder,
  type ChangeOrderLineInput,
} from "@/server/projects/change-orders";
import { ValidationError } from "@/lib/errors";

const details = (v: Record<string, string>) => ({
  title: v.title ?? "",
  reason: v.reason ?? "",
  description: v.description,
  scopeImpact: v.scopeImpact,
  scheduleImpact: v.scheduleImpact,
  scheduleImpactDays: v.scheduleImpactDays,
});

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

export async function createChangeOrderAction(projectId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createChangeOrder(await requireActor(), projectId, details(values)));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/projects/${projectId}/changes/${id}`);
}

export async function updateChangeOrderAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => updateChangeOrder(await requireActor(), id, details(v)),
    "Saved",
  );
}

export async function saveChangeLineAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      saveChangeOrderLine(await requireActor(), id, {
        lineId: v.lineId,
        budgetLineId: v.budgetLineId === "new" ? "" : v.budgetLineId,
        newCategory: v.newCategory as ChangeOrderLineInput["newCategory"],
        newDescription: v.newDescription,
        newCostCodeId: v.newCostCodeId,
        cost: v.cost,
        revenue: v.revenue,
        note: v.note,
      }),
    "Change saved",
  );
}

export async function removeChangeLineAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async ({ lineId = "" }) =>
    removeChangeOrderLine(await requireActor(), id, lineId),
  );
}

export async function clientApprovalAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      recordClientApproval(await requireActor(), id, {
        clientApprovedOn: v.clientApprovedOn,
        clientApprovedByName: v.clientApprovedByName ?? "",
        clientApprovalMethod: (v.clientApprovalMethod ?? "") as "EMAIL",
        clientApprovalReference: v.clientApprovalReference,
      }),
    "Client agreement recorded",
  );
}

/** One action for every workflow step; `command` says which. */
export async function changeOrderCommandAction(id: string, _: FormState, formData: FormData) {
  const command = formData.get("command");
  return run(formData, async ({ comment }) => {
    const actor = await requireActor();
    const input = { comment };
    switch (command) {
      case "submit":
        return submitChangeOrder(actor, id, input);
      case "approve":
        return approveChangeOrder(actor, id, input);
      case "reject":
        return rejectChangeOrder(actor, id, input);
      case "withdraw":
        return withdrawChangeOrder(actor, id, input);
      default:
        throw new ValidationError("Unknown action.");
    }
  });
}
