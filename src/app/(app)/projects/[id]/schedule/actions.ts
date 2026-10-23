"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import {
  deleteScheduleItem,
  saveScheduleItem,
  setBillingDueDate,
  setMilestoneDone,
  type ScheduleItemInput,
} from "@/server/projects/schedule";
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

export async function saveScheduleItemAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      saveScheduleItem(await requireActor(), projectId, {
        itemId: v.itemId,
        kind: (v.kind ?? "") as ScheduleItemInput["kind"],
        title: v.title ?? "",
        startDate: v.startDate,
        endDate: v.endDate,
        location: v.location,
        notes: v.notes,
      }),
    "Schedule saved",
  );
}

/** Done, reopen or delete; `command` says which. */
export async function scheduleItemCommandAction(_: FormState, formData: FormData) {
  return run(formData, async ({ itemId = "", command }) => {
    const actor = await requireActor();
    switch (command) {
      case "done":
        return setMilestoneDone(actor, itemId, true);
      case "reopen":
        return setMilestoneDone(actor, itemId, false);
      case "delete":
        return deleteScheduleItem(actor, itemId);
      default:
        throw new ValidationError("Unknown action.");
    }
  });
}

export async function billingDueDateAction(milestoneId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      setBillingDueDate(await requireActor(), milestoneId, { dueDate: v.dueDate, note: v.note }),
    "Due date saved",
  );
}
