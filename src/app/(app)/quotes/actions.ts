"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import { createQuote, saveDraft } from "@/server/commercial/quotes";
import {
  approveQuote,
  issueQuote,
  rejectQuote,
  reviseQuote,
  submitQuote,
  withdrawQuote,
} from "@/server/commercial/workflow";
import type { DraftLineInput } from "@/server/commercial/schemas";
import { acceptQuote, declineQuote } from "@/server/commercial/acceptance";
import { ValidationError } from "@/lib/errors";

export async function createQuoteAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createQuote(await requireActor(), {
      legalEntityId: values.legalEntityId ?? "",
      clientId: values.clientId ?? "",
      opportunityId: values.opportunityId,
      title: values.title ?? "",
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/quotes/${id}/edit`);
}

/** The editor sends its lines as JSON in a `lines` field; everything else is a plain field. */
export async function saveDraftAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    let lines: DraftLineInput[];
    try {
      lines = JSON.parse(values.lines ?? "[]") as DraftLineInput[];
    } catch {
      throw new ValidationError("The lines couldn't be read. Reload and try again.");
    }
    await saveDraft(await requireActor(), id, {
      expectedUpdatedAt: values.expectedUpdatedAt,
      title: values.title ?? "",
      contactId: values.contactId,
      currency: values.currency ?? "",
      fxRate: values.fxRate,
      fxNote: values.fxNote,
      validUntil: values.validUntil,
      paymentTermId: values.paymentTermId,
      taxRateId: values.taxRateId,
      contingency: values.contingency,
      poRequired: values.poRequired,
      eventStartDate: values.eventStartDate,
      eventEndDate: values.eventEndDate,
      venue: values.venue,
      scope: values.scope,
      deliverables: values.deliverables,
      exclusions: values.exclusions,
      terms: values.terms,
      internalNotes: values.internalNotes,
      lines,
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/quotes/${id}?saved=1`);
}

/** One action for every workflow step; `command` says which. */
export async function quoteCommandAction(id: string, _: FormState, formData: FormData) {
  const command = formData.get("command");
  const state = await attempt(formData, async ({ comment }) => {
    const actor = await requireActor();
    const input = { comment };
    switch (command) {
      case "submit":
        return submitQuote(actor, id, input);
      case "approve":
        return approveQuote(actor, id, input);
      case "reject":
        return rejectQuote(actor, id, input);
      case "issue":
        return issueQuote(actor, id);
      case "revise":
        return reviseQuote(actor, id);
      case "withdraw":
        return withdrawQuote(actor, id, input);
      default:
        throw new ValidationError("Unknown action.");
    }
  });
  if (state.status !== "success") return state;
  redirect(command === "revise" ? `/quotes/${id}/edit` : `/quotes/${id}?done=${String(command)}`);
}

/** Records the client's acceptance; opens the project it created. */
export async function acceptQuoteAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let projectId: string;
  try {
    const actor = await requireActor();
    projectId = (await acceptQuote(actor, id, values)).id;
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/projects/${projectId}?created=1`);
}

export async function declineQuoteAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async (values) => {
    const actor = await requireActor();
    return declineQuote(actor, id, values);
  });
  if (state.status !== "success") return state;
  redirect(`/quotes/${id}?done=decline`);
}
