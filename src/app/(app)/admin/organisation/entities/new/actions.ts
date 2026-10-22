"use server";

import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { createLegalEntity } from "@/server/organisation/service";
import { formValues, toFormState, type FormState } from "@/server/http/action-result";

export async function createLegalEntityAction(
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  let id: string;
  try {
    const actor = await requireActor();
    ({ id } = await createLegalEntity(actor, {
      code: values.code ?? "",
      legalName: values.legalName ?? "",
      tradingName: values.tradingName,
      countryCode: values.countryCode ?? "",
      baseCurrency: values.baseCurrency ?? "",
      timezone: values.timezone ?? "",
      addressLine1: values.addressLine1,
      addressLine2: values.addressLine2,
      city: values.city,
      region: values.region,
      postalCode: values.postalCode,
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  // Outside the try: redirect() works by throwing.
  redirect(`/admin/organisation/entities/${id}?created=1`);
}
