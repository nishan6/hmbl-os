"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import { recordAdvance, recordAdvanceReturn, voidAdvance } from "@/server/finance/advances";

export async function recordAdvanceAction(legalEntityId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await recordAdvance(await requireActor(), legalEntityId, {
      personId: values.personId ?? "",
      projectId: values.projectId,
      purpose: values.purpose ?? "",
      date: values.date,
      paidFromId: values.paidFromId ?? "",
      method: (values.method ?? "") as "UPI",
      reference: values.reference,
      amount: values.amount ?? "",
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/advances/${id}`);
}

export async function returnAdvanceAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      recordAdvanceReturn(await requireActor(), id, {
        date: v.date,
        depositAccountId: v.depositAccountId ?? "",
        amount: v.amount ?? "",
        reference: v.reference,
      }),
    "Recorded",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function voidAdvanceAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ date, reason }) =>
    voidAdvance(await requireActor(), id, { date, reason: reason ?? "" }),
  );
  if (state.status === "success") refresh();
  return state;
}
