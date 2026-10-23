"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { addDefaultNumberingSchemes } from "@/server/numbering/service";

export async function addDefaultSchemesAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ legalEntityId = "" }) =>
    addDefaultNumberingSchemes(await requireActor(), legalEntityId),
  );
  if (state.status === "success") refresh();
  return state;
}
