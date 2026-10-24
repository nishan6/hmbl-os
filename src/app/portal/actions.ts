"use server";

import { refresh } from "next/cache";
import { attempt, type FormState } from "@/server/http/action-result";
import { respondToQuote, submitProjectInformation } from "@/server/portal/client";
import { requirePortalActor } from "@/server/portal/session";

export async function submitInformationAction(projectId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      submitProjectInformation(await requirePortalActor(), projectId, {
        subject: v.subject ?? "",
        body: v.body ?? "",
      }),
    "Sent to HMBL",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function acceptQuoteAction(quoteId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      respondToQuote(await requirePortalActor(), quoteId, {
        response: "ACCEPTED",
        typedName: v.typedName ?? "",
        clientPoNumber: v.clientPoNumber,
        contentSha256: v.contentSha256 ?? "",
        confirm: v.confirm === "on",
      }),
    "Thank you. Your acceptance is recorded.",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function declineQuoteAction(quoteId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      respondToQuote(await requirePortalActor(), quoteId, {
        response: "DECLINED",
        typedName: v.typedName ?? "",
        reason: v.reason ?? "",
        contentSha256: v.contentSha256 ?? "",
      }),
    "Your answer is recorded.",
  );
  if (state.status === "success") refresh();
  return state;
}
