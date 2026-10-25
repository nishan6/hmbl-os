"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { publishCallSheet } from "@/server/production/call-sheets";
import { addNote, archiveNote, postStatusUpdate, updateNote } from "@/server/production/log";
import { deleteRunOfShowItem, saveRunOfShowItem } from "@/server/production/run-of-show";
import {
  archiveChecklist,
  createChecklist,
  saveChecklistItems,
  setItemDone,
} from "@/server/production/checklists";
import {
  reportIncident,
  resolveIncident,
  updateIncident,
  type IncidentInput,
} from "@/server/production/incidents";
import { ConflictError } from "@/lib/errors";
import { zonedToUtc } from "@/lib/time-zone";

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

export async function createChecklistAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      createChecklist(await requireActor(), projectId, {
        title: v.title ?? "",
        day: v.day,
        template: v.template,
        items: v.items,
      }),
    "Checklist created.",
  );
}

export async function tickItemAction(_: FormState, formData: FormData) {
  return run(formData, async (v) => {
    const result = await setItemDone(await requireActor(), v.itemId ?? "", {
      done: v.done === "true",
      baseVersion: v.baseVersion ? Number(v.baseVersion) : null,
    });
    if (result.conflict) {
      throw new ConflictError("Someone else changed this item just now. It has been reloaded.");
    }
  });
}

export async function saveChecklistItemsAction(
  checklistId: string,
  _: FormState,
  formData: FormData,
) {
  return run(
    formData,
    async (v) => {
      const ids = formData.getAll("itemId").map(String);
      const labels = formData.getAll("label").map(String);
      const extra = (v.add ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      return saveChecklistItems(await requireActor(), checklistId, {
        items: [
          ...labels
            .map((label, i) => ({ id: ids[i] || null, label: label.trim() }))
            .filter((r) => r.label),
          ...extra.map((label) => ({ id: null, label })),
        ],
      });
    },
    "Checklist saved.",
  );
}

export async function archiveChecklistAction(_: FormState, formData: FormData) {
  return run(formData, async (v) => archiveChecklist(await requireActor(), v.id ?? ""));
}

const incidentFields = (v: Record<string, string>): IncidentInput => ({
  // Typed in the venue's zone, which the form sends along.
  occurredAt: (v.occurredLocal && zonedToUtc(v.occurredLocal, v.timeZone ?? "UTC")) || "",
  category: (v.category ?? "") as IncidentInput["category"],
  severity: (v.severity ?? "") as IncidentInput["severity"],
  title: v.title ?? "",
  description: v.description ?? "",
  location: v.location,
  peopleInvolved: v.peopleInvolved,
  actionTaken: v.actionTaken,
});

export async function reportIncidentAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => reportIncident(await requireActor(), projectId, incidentFields(v)),
    "Incident reported.",
  );
}

export async function updateIncidentAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => updateIncident(await requireActor(), id, incidentFields(v)),
    "Incident saved.",
  );
}

export async function resolveIncidentAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => resolveIncident(await requireActor(), id, { resolution: v.resolution ?? "" }),
    "Incident resolved.",
  );
}
