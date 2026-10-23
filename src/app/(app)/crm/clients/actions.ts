"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  createClient,
  createContact,
  mergeClient,
  setClientArchived,
  setContactArchived,
  setPrimaryContact,
  updateClient,
} from "@/server/crm/clients";
import type { ClientInput, ContactInput } from "@/server/crm/schemas";

function clientFrom(v: Record<string, string>): ClientInput {
  return {
    name: v.name ?? "",
    legalName: v.legalName,
    kind: (v.kind ?? "COMPANY") as ClientInput["kind"],
    industry: v.industry,
    website: v.website,
    email: v.email,
    phone: v.phone,
    taxIdType: v.taxIdType,
    taxId: v.taxId,
    addressLine1: v.addressLine1,
    addressLine2: v.addressLine2,
    city: v.city,
    region: v.region,
    postalCode: v.postalCode,
    countryCode: v.countryCode ?? "",
    currency: v.currency ?? "",
    ownerId: v.ownerId || null,
    notes: v.notes,
    allowDuplicate: v.allowDuplicate,
  };
}

function contactFrom(v: Record<string, string>): ContactInput {
  return {
    name: v.name ?? "",
    jobTitle: v.jobTitle,
    email: v.email,
    phone: v.phone,
    isPrimary: v.isPrimary,
    notes: v.notes,
  };
}

export async function createClientAction(_: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createClient(await requireActor(), clientFrom(values)));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/crm/clients/${id}?created=1`);
}

export async function updateClientAction(
  id: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  try {
    await updateClient(await requireActor(), id, clientFrom(values));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/crm/clients/${id}`);
}

export async function clientCommandAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ id = "", command }) =>
    setClientArchived(await requireActor(), id, command === "archive"),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function mergeClientAction(
  duplicateId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  try {
    await mergeClient(await requireActor(), duplicateId, values);
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/crm/clients/${values.targetId}?merged=1`);
}

export async function createContactAction(clientId: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async (v) =>
    createContact(await requireActor(), clientId, contactFrom(v)),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function contactCommandAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ id = "", command }) => {
    const actor = await requireActor();
    if (command === "primary") return setPrimaryContact(actor, id);
    return setContactArchived(actor, id, command === "archive");
  });
  if (state.status === "success") refresh();
  return state;
}
