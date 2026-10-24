"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  addCertification,
  addCrewRate,
  addUnavailability,
  createCrewMember,
  endCrewRate,
  removeCertification,
  removeUnavailability,
  setCrewArchived,
  updateCrewMember,
  type CrewMemberInput,
  type CrewRateInput,
} from "@/server/crew/members";

const fields = (v: Record<string, string>): CrewMemberInput => ({
  name: v.name ?? "",
  kind: (v.kind ?? "") as CrewMemberInput["kind"],
  userId: v.userId,
  vendorId: v.vendorId,
  email: v.email,
  phone: v.phone,
  baseCity: v.baseCity,
  preferredLocations: v.preferredLocations,
  skills: v.skills,
  contractRef: v.contractRef,
  notes: v.notes,
  emergencyContactName: v.emergencyContactName,
  emergencyContactPhone: v.emergencyContactPhone,
  emergencyContactRelation: v.emergencyContactRelation,
});

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

export async function createCrewAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createCrewMember(await requireActor(), fields(values)));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/crew/${id}`);
}

export async function updateCrewAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) => updateCrewMember(await requireActor(), id, fields(v)), "Saved");
}

export async function archiveCrewAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async ({ archived }) =>
    setCrewArchived(await requireActor(), id, archived === "true"),
  );
}

export async function addRateAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      addCrewRate(await requireActor(), id, {
        role: v.role,
        type: (v.type ?? "") as CrewRateInput["type"],
        currency: v.currency ?? "",
        amount: v.amount,
        validFrom: v.validFrom,
        notes: v.notes,
      }),
    "Rate added",
  );
}

export async function endRateAction(_: FormState, formData: FormData) {
  return run(formData, async ({ rateId = "", validTo }) =>
    endCrewRate(await requireActor(), rateId, { validTo }),
  );
}

export async function addCertificationAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      addCertification(await requireActor(), id, {
        name: v.name ?? "",
        issuer: v.issuer,
        reference: v.reference,
        issuedOn: v.issuedOn,
        expiresOn: v.expiresOn,
      }),
    "Certification added",
  );
}

export async function removeCertificationAction(_: FormState, formData: FormData) {
  return run(formData, async ({ certificationId = "" }) =>
    removeCertification(await requireActor(), certificationId),
  );
}

export async function addUnavailabilityAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      addUnavailability(await requireActor(), id, {
        startDate: v.startDate,
        endDate: v.endDate,
        reason: v.reason,
      }),
    "Time off added",
  );
}

export async function removeUnavailabilityAction(_: FormState, formData: FormData) {
  return run(formData, async ({ unavailabilityId = "" }) =>
    removeUnavailability(await requireActor(), unavailabilityId),
  );
}
