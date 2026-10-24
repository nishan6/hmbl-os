"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { publishCallSheet } from "@/server/production/call-sheets";
import { addNote, archiveNote, postStatusUpdate, updateNote } from "@/server/production/log";
import { deleteRunOfShowItem, saveRunOfShowItem } from "@/server/production/run-of-show";

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

export async function saveRunOfShowAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      saveRunOfShowItem(
        await requireActor(),
        projectId,
        {
          day: v.day,
          startTime: v.startTime ?? "",
          durationMinutes: v.durationMinutes,
          title: v.title ?? "",
          owner: v.owner,
          location: v.location,
          notes: v.notes,
        },
        v.id || undefined,
      ),
    "Saved.",
  );
}

export async function deleteRunOfShowAction(_: FormState, formData: FormData) {
  return run(formData, async (v) => deleteRunOfShowItem(await requireActor(), v.id ?? ""));
}

export async function publishCallSheetAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => publishCallSheet(await requireActor(), projectId, { day: v.day, notes: v.notes }),
    "Published.",
  );
}

export async function addNoteAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => addNote(await requireActor(), projectId, { body: v.body ?? "", pinned: v.pinned }),
    "Note added.",
  );
}

export async function updateNoteAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => updateNote(await requireActor(), id, { body: v.body ?? "", pinned: v.pinned }),
    "Note saved.",
  );
}

export async function archiveNoteAction(_: FormState, formData: FormData) {
  return run(formData, async (v) => archiveNote(await requireActor(), v.id ?? ""));
}

export async function postStatusAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      postStatusUpdate(await requireActor(), projectId, {
        status: (v.status ?? "") as "INFO",
        message: v.message ?? "",
      }),
    "Update posted.",
  );
}
