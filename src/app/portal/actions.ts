"use server";

import { refresh } from "next/cache";
import { attempt, type FormState } from "@/server/http/action-result";
import { respondToQuote, submitProjectInformation } from "@/server/portal/client";
import { answerBooking, submitTimesheetDay } from "@/server/portal/freelancer";
import { requestDetailsChange, updateMyContactDetails } from "@/server/portal/profile";
import { requirePortalActor } from "@/server/portal/session";
import { answerVendorOrder } from "@/server/portal/vendor";

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

export async function answerOrderAction(
  orderId: string,
  revision: number,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async (v) =>
      answerVendorOrder(await requirePortalActor(), orderId, revision, {
        answer: v.answer === "DECLINED" ? "DECLINED" : "CONFIRMED",
        note: v.note ?? "",
      }),
    "Your answer is recorded.",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function answerBookingAction(assignmentId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      answerBooking(await requirePortalActor(), assignmentId, {
        answer: v.answer === "DECLINED" ? "DECLINED" : "CONFIRMED",
        note: v.note ?? "",
      }),
    "Your answer is recorded.",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function timesheetAction(assignmentId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      submitTimesheetDay(await requirePortalActor(), assignmentId, {
        date: v.date ?? "",
        day: v.day === "HALF" ? "HALF" : "FULL",
        overtimeMinutes: Math.round(Number(v.overtimeHours || 0) * 60),
        expenses: v.expenses,
        notes: v.notes,
      }),
    "Day saved. HMBL will approve it.",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function updateDetailsAction(_: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => updateMyContactDetails(await requirePortalActor(), v),
    "Your details are saved.",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function requestDetailsAction(_: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => requestDetailsChange(await requirePortalActor(), { details: v.details ?? "" }),
    "Sent to HMBL. They will check it and update your record.",
  );
  if (state.status === "success") refresh();
  return state;
}
