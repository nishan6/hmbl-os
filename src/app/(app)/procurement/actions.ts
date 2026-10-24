"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import { draftBillFromOrder } from "@/server/procurement/billing";
import {
  approveOrder,
  cancelOrder,
  closeOrder,
  createOrder,
  recordReceipt,
  rejectOrder,
  saveOrder,
  startAmendment,
  submitOrder,
  withdrawAmendment,
  type NewOrderInput,
  type OrderLineInput,
} from "@/server/procurement/orders";
import { updateProcurementSettings } from "@/server/procurement/settings";
import { ValidationError } from "@/lib/errors";

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

export async function startOrderAction(legalEntityId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createOrder(await requireActor(), legalEntityId, {
      vendorId: values.vendorId ?? "",
      kind: (values.kind ?? "") as NewOrderInput["kind"],
      projectId: values.projectId,
      costCentreId: values.costCentreId,
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/procurement/${id}/edit`);
}

function linesOf(values: Record<string, string>): OrderLineInput[] {
  try {
    return JSON.parse(values.lines ?? "[]") as OrderLineInput[];
  } catch {
    throw new ValidationError("The lines couldn't be read. Reload and try again.");
  }
}

export async function saveOrderAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await saveOrder(await requireActor(), id, {
      requiredDate: values.requiredDate,
      hireFrom: values.hireFrom,
      hireTo: values.hireTo,
      deliveryLocationId: values.deliveryLocationId,
      deliveryNotes: values.deliveryNotes,
      terms: values.terms,
      notes: values.notes,
      supplyType: (values.supplyType ?? "") as "INTRA_STATE",
      lines: linesOf(values),
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/procurement/${id}`);
}

/** Submit, approve or withdraw an amendment; `command` says which. */
export async function orderCommandAction(id: string, _: FormState, formData: FormData) {
  const command = formData.get("command");
  return run(formData, async () => {
    const actor = await requireActor();
    switch (command) {
      case "submit":
        return submitOrder(actor, id);
      case "approve":
        return approveOrder(actor, id);
      case "withdraw":
        return withdrawAmendment(actor, id);
      default:
        throw new ValidationError("Unknown action.");
    }
  });
}

export async function rejectOrderAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) => rejectOrder(await requireActor(), id, { reason: v.reason }));
}

export async function amendOrderAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await startAmendment(await requireActor(), id, { reason: values.reason });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/procurement/${id}/edit`);
}

export async function cancelOrderAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) => cancelOrder(await requireActor(), id, { reason: v.reason }));
}

export async function closeOrderAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) => closeOrder(await requireActor(), id, { reason: v.reason }));
}

export async function receiptAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      recordReceipt(await requireActor(), id, {
        kind: (v.kind || "RECEIVED") as "RECEIVED",
        receivedOn: v.receivedOn,
        locationId: v.locationId,
        reference: v.reference,
        notes: v.notes,
        quantities: Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => k.startsWith("qty:"))
            .map(([k, q]) => [k.slice(4), q]),
        ),
      }),
    "Recorded",
  );
}

export async function billOrderAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let billId: string;
  try {
    ({ id: billId } = await draftBillFromOrder(await requireActor(), id));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/bills/${billId}/edit`);
}

export async function procurementSettingsAction(
  legalEntityId: string,
  _: FormState,
  formData: FormData,
) {
  return run(
    formData,
    async (v) =>
      updateProcurementSettings(await requireActor(), legalEntityId, {
        approvalThreshold: v.approvalThreshold ?? "",
      }),
    "Saved",
  );
}
