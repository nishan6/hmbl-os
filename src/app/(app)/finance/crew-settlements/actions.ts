"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { formValues, toFormState, type FormState } from "@/server/http/action-result";
import { createSettlement } from "@/server/crew/settlements";

export async function createSettlementAction(entityId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let billId: string;
  try {
    ({
      bill: { id: billId },
    } = await createSettlement(await requireActor(), entityId, values.crewMemberId ?? ""));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/bills/${billId}`);
}
