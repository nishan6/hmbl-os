"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  createInvoice,
  discardInvoice,
  issueInvoice,
  makeInvoiceFrom,
  recogniseInvoiceRevenue,
  saveInvoiceDraft,
  type InvoiceLineInput,
} from "@/server/finance/invoices";
import {
  createCreditNote,
  discardCreditNote,
  issueCreditNote,
} from "@/server/finance/credit-notes";
import { ValidationError } from "@/lib/errors";

/** Editors send their lines as JSON in a `lines` field. */
function linesOf<T>(values: Record<string, string>): T[] {
  try {
    return JSON.parse(values.lines ?? "[]") as T[];
  } catch {
    throw new ValidationError("The lines couldn't be read. Reload and try again.");
  }
}

export async function startInvoiceAction(legalEntityId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createInvoice(await requireActor(), legalEntityId, {
      kind: (values.kind || "TAX") as "TAX",
      clientId: values.clientId ?? "",
      projectId: values.projectId,
      milestoneId: values.milestoneId,
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/invoices/${id}/edit`);
}

export async function saveInvoiceAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await saveInvoiceDraft(await requireActor(), id, {
      invoiceDate: values.invoiceDate,
      dueDate: values.dueDate,
      currency: values.currency ?? "",
      fxRate: values.fxRate,
      fxNote: values.fxNote,
      placeOfSupplyCountry: values.placeOfSupplyCountry ?? "",
      placeOfSupplyCode: values.placeOfSupplyCode,
      clientPoNumber: values.clientPoNumber,
      serviceCode: values.serviceCode,
      notes: values.notes,
      lines: linesOf<InvoiceLineInput>(values),
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/invoices/${id}`);
}

/** Issue, discard or recognise revenue; `command` says which. */
export async function invoiceCommandAction(id: string, _: FormState, formData: FormData) {
  const command = formData.get("command");
  const state = await attempt(formData, async () => {
    const actor = await requireActor();
    switch (command) {
      case "issue":
        return issueInvoice(actor, id);
      case "discard":
        return discardInvoice(actor, id);
      case "recognise":
        return recogniseInvoiceRevenue(actor, id);
      default:
        throw new ValidationError("Unknown action.");
    }
  });
  if (state.status === "success") refresh();
  return state;
}

/** Drafts the commercial or tax invoice for an issued proforma or commercial one. */
export async function makeInvoiceFromAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let draftId: string;
  try {
    ({ id: draftId } = await makeInvoiceFrom(await requireActor(), id, {
      kind: (values.kind ?? "") as "TAX",
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/invoices/${draftId}/edit`);
}

export async function createCreditNoteAction(invoiceId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createCreditNote(await requireActor(), invoiceId, {
      date: values.date,
      reason: values.reason ?? "",
      lines: linesOf<{ invoiceLineId: string; amount: string }>(values),
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/credit-notes/${id}`);
}

/** Issue or discard a credit note; `command` says which. */
export async function creditNoteCommandAction(id: string, _: FormState, formData: FormData) {
  const command = formData.get("command");
  const state = await attempt(formData, async () => {
    const actor = await requireActor();
    switch (command) {
      case "issue":
        return issueCreditNote(actor, id);
      case "discard":
        return discardCreditNote(actor, id);
      default:
        throw new ValidationError("Unknown action.");
    }
  });
  if (state.status === "success") refresh();
  return state;
}
