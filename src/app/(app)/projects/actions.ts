"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  changeProjectStatus,
  createProject,
  updateProjectDetails,
} from "@/server/projects/projects";

function details(v: Record<string, string>) {
  return {
    name: v.name ?? "",
    projectTypeId: v.projectTypeId,
    revenueModel: (v.revenueModel ?? "") as "ITEMISED",
    businessUnitId: v.businessUnitId,
    projectManagerId: v.projectManagerId,
    producerId: v.producerId,
    clientPoNumber: v.clientPoNumber,
    eventStartDate: v.eventStartDate,
    eventEndDate: v.eventEndDate,
    venue: v.venue,
    locations: v.locations,
    description: v.description,
    scope: v.scope,
    deliverables: v.deliverables,
  };
}

export async function createProjectAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createProject(await requireActor(), {
      ...details(values),
      legalEntityId: values.legalEntityId ?? "",
      clientId: values.clientId,
      currency: values.currency ?? "",
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/projects/${id}`);
}

export async function updateProjectAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await updateProjectDetails(await requireActor(), id, details(values));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/projects/${id}?saved=1`);
}

export async function changeStatusAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      changeProjectStatus(await requireActor(), id, {
        to: (v.to ?? "") as "PLANNING",
        reason: v.reason,
      }),
    "Status changed",
  );
  if (state.status === "success") refresh();
  return state;
}
