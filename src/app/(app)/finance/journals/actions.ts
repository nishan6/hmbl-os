"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  createJournal,
  discardJournal,
  postManualJournal,
  reverseManualJournal,
  updateJournal,
  type JournalDraftInput,
  type JournalLineInput,
} from "@/server/finance/journals";
import { ValidationError } from "@/lib/errors";

/** The editor sends its lines as JSON in a `lines` field. */
function draft(values: Record<string, string>): JournalDraftInput {
  let lines: JournalLineInput[];
  try {
    lines = JSON.parse(values.lines ?? "[]") as JournalLineInput[];
  } catch {
    throw new ValidationError("The lines couldn't be read. Reload and try again.");
  }
  return {
    date: values.date,
    narration: values.narration ?? "",
    openingBalance: values.openingBalance,
    lines,
  };
}

export async function createJournalAction(legalEntityId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createJournal(await requireActor(), legalEntityId, draft(values)));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/journals/${id}`);
}

export async function updateJournalAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await updateJournal(await requireActor(), id, draft(values));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/journals/${id}`);
}

/** Post, discard or reverse; `command` says which. */
export async function journalCommandAction(id: string, _: FormState, formData: FormData) {
  const command = formData.get("command");
  const state = await attempt(formData, async ({ date, reason }) => {
    const actor = await requireActor();
    switch (command) {
      case "post":
        return postManualJournal(actor, id);
      case "discard":
        return discardJournal(actor, id);
      case "reverse":
        return reverseManualJournal(actor, id, { date, reason: reason ?? "" });
      default:
        throw new ValidationError("Unknown action.");
    }
  });
  if (state.status === "success") refresh();
  return state;
}
