"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { archiveDocument } from "@/server/projects/documents";

export async function archiveDocumentAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async ({ comment }) => archiveDocument(await requireActor(), id, { reason: comment }),
    "Archived",
  );
  if (state.status === "success") refresh();
  return state;
}
