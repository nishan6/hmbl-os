"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { importOpeningFile, postOpening, saveOpeningSetup } from "@/server/finance/opening";

export async function saveOpeningSetupAction(
  legalEntityId: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async (v) =>
      saveOpeningSetup(await requireActor(), legalEntityId, {
        ...v,
        sourceSystem: v.sourceSystem ?? "",
      }),
    "Saved",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function importOpeningFileAction(
  legalEntityId: string,
  _: FormState,
  formData: FormData,
) {
  let rows = 0;
  const state = await attempt(formData, async (v) => {
    ({ count: rows } = await importOpeningFile(await requireActor(), legalEntityId, {
      section: v.section ?? "",
      text: v.text ?? "",
    }));
  });
  if (state.status !== "success") return state;
  refresh();
  return {
    ...state,
    message: `${rows} row${rows === 1 ? "" : "s"} saved, replacing the earlier file`,
  };
}

export async function postOpeningAction(legalEntityId: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async () =>
    postOpening(await requireActor(), legalEntityId),
  );
  if (state.status === "success") refresh();
  return state;
}
