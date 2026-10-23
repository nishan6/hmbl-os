"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { closePeriod, reopenPeriod } from "@/server/finance/period-close";
import { attempt, type FormState } from "@/server/http/action-result";

export async function closePeriodAction(periodId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => closePeriod(await requireActor(), periodId, { note: v.note }),
    "Period closed",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function reopenPeriodAction(periodId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => reopenPeriod(await requireActor(), periodId, { reason: v.reason }),
    "Period reopened",
  );
  if (state.status === "success") refresh();
  return state;
}
