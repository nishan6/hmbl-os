"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import {
  deleteRequirement,
  saveRequirement,
  type RequirementInput,
} from "@/server/projects/resources";
import {
  approveWork,
  confirmAssignment,
  endAssignment,
  proposeAssignment,
  recordWork,
  removeWork,
  substituteAssignment,
  updateAssignment,
} from "@/server/crew/assignments";
import { ValidationError } from "@/lib/errors";
import { parseOvertime } from "@/lib/crew";

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

export async function saveRequirementAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      saveRequirement(await requireActor(), projectId, {
        requirementId: v.requirementId,
        kind: (v.kind ?? "") as RequirementInput["kind"],
        name: v.name ?? "",
        quantity: v.quantity ?? "",
        startDate: v.startDate,
        endDate: v.endDate,
        budgetLineId: v.budgetLineId,
        dayRate: v.dayRate,
        notes: v.notes,
      }),
    "Plan saved",
  );
}

export async function deleteRequirementAction(_: FormState, formData: FormData) {
  return run(formData, async ({ requirementId = "" }) =>
    deleteRequirement(await requireActor(), requirementId),
  );
}

export async function proposeCrewAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      proposeAssignment(await requireActor(), projectId, {
        requirementId: v.requirementId,
        crewMemberId: v.crewMemberId ?? "",
        role: v.role,
        startDate: v.startDate,
        endDate: v.endDate,
        dayRate: v.dayRate,
        callTime: v.callTime,
        reportTo: v.reportTo,
        notes: v.notes,
      }),
    "Crew proposed",
  );
}

export async function confirmCrewAction(_: FormState, formData: FormData) {
  return run(
    formData,
    async ({ assignmentId = "", overrideReason }) =>
      confirmAssignment(await requireActor(), assignmentId, { overrideReason }),
    "Booking confirmed",
  );
}

export async function updateCrewAction(assignmentId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      updateAssignment(await requireActor(), assignmentId, {
        role: v.role ?? "",
        startDate: v.startDate,
        endDate: v.endDate,
        dayRate: v.dayRate,
        callTime: v.callTime,
        reportTo: v.reportTo,
        notes: v.notes,
        overrideReason: v.overrideReason,
      }),
    "Booking saved",
  );
}

export async function endCrewAction(_: FormState, formData: FormData) {
  return run(
    formData,
    async ({ assignmentId = "", to, reason }) =>
      endAssignment(
        await requireActor(),
        assignmentId,
        to === "DECLINED" ? "DECLINED" : "CANCELLED",
        { reason },
      ),
    "Booking ended",
  );
}

export async function substituteCrewAction(assignmentId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async ({ crewMemberId = "", reason }) =>
      substituteAssignment(await requireActor(), assignmentId, {
        crewMemberId,
        reason: reason ?? "",
      }),
    "Replacement proposed",
  );
}

export async function recordWorkAction(assignmentId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => {
      const overtimeMinutes = parseOvertime(v.overtime);
      if (overtimeMinutes === null) {
        throw new ValidationError("Check the highlighted fields.", {
          overtime: ["Enter hours such as 2.5 or 2:30"],
        });
      }
      return recordWork(await requireActor(), assignmentId, {
        date: v.date,
        day: v.day === "HALF" ? "HALF" : "FULL",
        overtimeMinutes,
        expenses: v.expenses,
        notes: v.notes,
      });
    },
    "Day recorded",
  );
}

export async function removeWorkAction(_: FormState, formData: FormData) {
  return run(formData, async ({ workRecordId = "" }) =>
    removeWork(await requireActor(), workRecordId),
  );
}

export async function approveWorkAction(_: FormState, formData: FormData) {
  return run(formData, async ({ assignmentId = "" }) =>
    approveWork(await requireActor(), assignmentId),
  );
}
