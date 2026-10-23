"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  approveBill,
  createBill,
  discardBill,
  rejectBill,
  saveBillDraft,
  submitBill,
  voidBill,
  type BillLineInput,
} from "@/server/finance/bills";
import { ValidationError } from "@/lib/errors";

function linesOf(values: Record<string, string>): BillLineInput[] {
  try {
    return JSON.parse(values.lines ?? "[]") as BillLineInput[];
  } catch {
    throw new ValidationError("The lines couldn't be read. Reload and try again.");
  }
}

export async function startBillAction(legalEntityId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createBill(await requireActor(), legalEntityId, {
      vendorId: values.vendorId ?? "",
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/bills/${id}/edit`);
}

export async function saveBillAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await saveBillDraft(await requireActor(), id, {
      vendorInvoiceNumber: values.vendorInvoiceNumber ?? "",
      billDate: values.billDate,
      dueDate: values.dueDate,
      currency: values.currency ?? "",
      fxRate: values.fxRate,
      supplyType: (values.supplyType ?? "") as "INTRA_STATE",
      tdsSection: values.tdsSection,
      tdsRate: values.tdsRate,
      notes: values.notes,
      lines: linesOf(values),
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/bills/${id}`);
}

/** Submit, approve or discard; `command` says which. */
export async function billCommandAction(id: string, _: FormState, formData: FormData) {
  const command = formData.get("command");
  const state = await attempt(formData, async () => {
    const actor = await requireActor();
    switch (command) {
      case "submit":
        return submitBill(actor, id);
      case "approve":
        return approveBill(actor, id);
      case "discard":
        return discardBill(actor, id);
      default:
        throw new ValidationError("Unknown action.");
    }
  });
  if (state.status === "success") refresh();
  return state;
}

export async function rejectBillAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ reason }) =>
    rejectBill(await requireActor(), id, { reason }),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function voidBillAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ date, reason }) =>
    voidBill(await requireActor(), id, { date, reason: reason ?? "" }),
  );
  if (state.status === "success") refresh();
  return state;
}
