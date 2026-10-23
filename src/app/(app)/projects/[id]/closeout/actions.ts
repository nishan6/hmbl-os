"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { setCloseoutItem, type CloseoutItemInput } from "@/server/projects/closeout";

export async function closeoutItemAction(
  projectId: string,
  key: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async ({ command, comment }) =>
      setCloseoutItem(await requireActor(), projectId, {
        key: key as CloseoutItemInput["key"],
        state: command as CloseoutItemInput["state"],
        note: comment,
      }),
    "Saved",
  );
  if (state.status === "success") refresh();
  return state;
}
