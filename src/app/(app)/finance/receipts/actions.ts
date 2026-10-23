"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import { allocateReceipt, recordReceipt, voidReceipt } from "@/server/finance/receipts";
import { ValidationError } from "@/lib/errors";

type Allocation = { invoiceId: string; amount: string };

function allocationsOf(values: Record<string, string>): Allocation[] {
  try {
    return JSON.parse(values.allocations ?? "[]") as Allocation[];
  } catch {
    throw new ValidationError("The allocations couldn't be read. Reload and try again.");
  }
}

export async function recordReceiptAction(legalEntityId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await recordReceipt(await requireActor(), legalEntityId, {
      clientId: values.clientId ?? "",
      depositAccountId: values.depositAccountId ?? "",
      date: values.date,
      method: (values.method ?? "") as "UPI",
      reference: values.reference,
      currency: values.currency ?? "",
      fxRate: values.fxRate,
      amount: values.amount ?? "",
      tds: values.tds,
      tdsSection: values.tdsSection,
      notes: values.notes,
      allocations: allocationsOf(values),
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/receipts/${id}`);
}

export async function allocateReceiptAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async (values) =>
    allocateReceipt(await requireActor(), id, {
      date: values.date,
      allocations: allocationsOf(values),
    }),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function voidReceiptAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ date, reason }) =>
    voidReceipt(await requireActor(), id, { date, reason: reason ?? "" }),
  );
  if (state.status === "success") refresh();
  return state;
}
