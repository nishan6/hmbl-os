"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import { allocatePayment, recordPayment, voidPayment } from "@/server/finance/payments";
import { ValidationError } from "@/lib/errors";

type Allocation = { billId: string; amount: string };

function allocationsOf(values: Record<string, string>): Allocation[] {
  try {
    return JSON.parse(values.allocations ?? "[]") as Allocation[];
  } catch {
    throw new ValidationError("The allocations couldn't be read. Reload and try again.");
  }
}

export async function recordPaymentAction(legalEntityId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await recordPayment(await requireActor(), legalEntityId, {
      vendorId: values.vendorId ?? "",
      paidFromId: values.paidFromId ?? "",
      date: values.date,
      method: (values.method ?? "") as "UPI",
      reference: values.reference,
      currency: values.currency ?? "",
      fxRate: values.fxRate,
      amount: values.amount ?? "",
      notes: values.notes,
      allocations: allocationsOf(values),
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/payments/${id}`);
}

export async function allocatePaymentAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async (values) =>
    allocatePayment(await requireActor(), id, {
      date: values.date,
      allocations: allocationsOf(values),
    }),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function voidPaymentAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ date, reason }) =>
    voidPayment(await requireActor(), id, { date, reason: reason ?? "" }),
  );
  if (state.status === "success") refresh();
  return state;
}
