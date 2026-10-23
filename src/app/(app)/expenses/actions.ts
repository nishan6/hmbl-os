"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  approveClaim,
  createClaim,
  discardClaim,
  rejectClaim,
  saveClaimDraft,
  submitClaim,
  voidClaim,
  type ClaimLineInput,
} from "@/server/expenses/claims";
import { settleClaim, voidSettlement } from "@/server/finance/expense-settlements";
import { ValidationError } from "@/lib/errors";

function linesOf(values: Record<string, string>): ClaimLineInput[] {
  try {
    return JSON.parse(values.lines ?? "[]") as ClaimLineInput[];
  } catch {
    throw new ValidationError("The expenses couldn't be read. Reload and try again.");
  }
}

export async function startClaimAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createClaim(await requireActor(), {
      legalEntityId: values.legalEntityId ?? "",
      title: values.title ?? "",
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/expenses/${id}/edit`);
}

export async function saveClaimAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await saveClaimDraft(await requireActor(), id, {
      title: values.title ?? "",
      notes: values.notes,
      lines: linesOf(values),
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/expenses/${id}`);
}

/** Submit, approve or discard; `command` says which. */
export async function claimCommandAction(id: string, _: FormState, formData: FormData) {
  const command = formData.get("command");
  const state = await attempt(formData, async () => {
    const actor = await requireActor();
    switch (command) {
      case "submit":
        return submitClaim(actor, id);
      case "approve":
        return approveClaim(actor, id);
      case "discard":
        return discardClaim(actor, id);
      default:
        throw new ValidationError("Unknown action.");
    }
  });
  if (state.status === "success") {
    if (command === "discard") redirect("/expenses");
    refresh();
  }
  return state;
}

export async function rejectClaimAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ reason }) =>
    rejectClaim(await requireActor(), id, { reason }),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function voidClaimAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ date, reason }) =>
    voidClaim(await requireActor(), id, { date, reason: reason ?? "" }),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function settleClaimAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => {
      const [kind, source] = (v.source ?? "").split(":");
      return settleClaim(await requireActor(), id, {
        date: v.date,
        advanceId: kind === "advance" ? source : null,
        paidFromId: kind === "account" ? source : null,
        amount: v.amount ?? "",
        reference: v.reference,
      });
    },
    "Settled",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function voidSettlementAction(settlementId: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ date, reason }) =>
    voidSettlement(await requireActor(), settlementId, { date, reason: reason ?? "" }),
  );
  if (state.status === "success") refresh();
  return state;
}
