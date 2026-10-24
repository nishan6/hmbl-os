"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  createVendor,
  setVendorArchived,
  updateVendor,
  type VendorInput,
} from "@/server/vendors/service";

const fields = (v: Record<string, string>): VendorInput => ({
  name: v.name ?? "",
  legalName: v.legalName,
  kind: (v.kind || "COMPANY") as "COMPANY",
  email: v.email,
  phone: v.phone,
  gstin: v.gstin,
  pan: v.pan,
  msmeNumber: v.msmeNumber,
  addressLine1: v.addressLine1,
  addressLine2: v.addressLine2,
  city: v.city,
  region: v.region,
  postalCode: v.postalCode,
  countryCode: v.countryCode ?? "",
  currency: v.currency ?? "",
  paymentTermsDays: v.paymentTermsDays ?? "",
  tdsSection: v.tdsSection,
  tdsRate: v.tdsRate,
  bankAccountName: v.bankAccountName,
  bankAccountNumber: v.bankAccountNumber,
  bankIfsc: v.bankIfsc,
  notes: v.notes,
});

export async function createProcurementVendorAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createVendor(await requireActor(), fields(values)));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/procurement/vendors/${id}`);
}

export async function updateProcurementVendorAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => updateVendor(await requireActor(), id, fields(v)),
    "Vendor saved",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function archiveProcurementVendorAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async ({ archived }) =>
    setVendorArchived(await requireActor(), id, archived === "true"),
  );
  if (state.status === "success") refresh();
  return state;
}
