"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import { createOpportunity, moveOpportunity, updateOpportunity } from "@/server/crm/pipeline";
import { completeActivity, createActivity } from "@/server/crm/activities";
import type { ActivityInput, OpportunityInput } from "@/server/crm/pipeline-schemas";

function opportunityFrom(v: Record<string, string>): OpportunityInput {
  return {
    legalEntityId: v.legalEntityId ?? "",
    clientId: v.clientId ?? "",
    contactId: v.contactId,
    title: v.title ?? "",
    description: v.description,
    ownerId: v.ownerId ?? undefined,
    businessUnitId: v.businessUnitId,
    source: v.source,
    currency: v.currency ?? "",
    expectedValue: v.expectedValue,
    probability: v.probability,
    expectedCloseDate: v.expectedCloseDate,
    eventStartDate: v.eventStartDate,
    eventEndDate: v.eventEndDate,
    venue: v.venue,
    competitors: v.competitors,
  };
}

export async function createOpportunityAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createOpportunity(await requireActor(), opportunityFrom(values)));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/crm/opportunities/${id}?created=1`);
}

export async function updateOpportunityAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await updateOpportunity(await requireActor(), id, opportunityFrom(values));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/crm/opportunities/${id}`);
}

export async function moveOpportunityAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => moveOpportunity(await requireActor(), id, v),
    "Stage updated",
  );
  if (state.status === "success") refresh();
  return state;
}

function activityFrom(v: Record<string, string>): ActivityInput {
  return {
    type: (v.type ?? "NOTE") as ActivityInput["type"],
    subject: v.subject ?? "",
    body: v.body,
    dueAt: v.dueAt,
  };
}

export async function addActivityAction(
  about: { clientId: string } | { opportunityId: string },
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(formData, async (v) =>
    createActivity(await requireActor(), about, activityFrom(v)),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function completeActivityAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ id = "" }) =>
    completeActivity(await requireActor(), id),
  );
  if (state.status === "success") refresh();
  return state;
}
