"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { runReadiness } from "@/server/readiness/runs";

export async function runReadinessAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async () => runReadiness(await requireActor()));
  if (state.status === "success") refresh();
  return state;
}
