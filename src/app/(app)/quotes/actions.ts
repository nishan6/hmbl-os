"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { formValues, toFormState, type FormState } from "@/server/http/action-result";
import { createQuote, saveDraft } from "@/server/commercial/quotes";
import type { DraftLineInput } from "@/server/commercial/schemas";
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
