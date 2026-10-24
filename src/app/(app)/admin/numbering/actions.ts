"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  addDefaultNumberingSchemes,
  replaceNumberingScheme,
  setNumberCounter,
} from "@/server/numbering/service";

export async function addDefaultSchemesAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ legalEntityId = "" }) =>
    addDefaultNumberingSchemes(await requireActor(), legalEntityId),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function setCounterAction(schemeId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      setNumberCounter(await requireActor(), schemeId, {
        date: v.date,
        clientCode: v.clientCode,
        lastValue: v.lastValue,
      }),
    "Count set",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function replaceSchemeAction(schemeId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await replaceNumberingScheme(await requireActor(), schemeId, {
      pattern: values.pattern ?? "",
      resetPolicy: (values.resetPolicy ?? "") as "NEVER",
      startAt: values.startAt,
      fiscalYearStartMonth: values.fiscalYearStartMonth,
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/admin/numbering/${id}`);
}
