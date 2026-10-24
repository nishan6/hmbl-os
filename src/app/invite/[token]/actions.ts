"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvitation } from "@/server/portal/accept";
import { formValues, toFormState, type FormState } from "@/server/http/action-result";

export async function acceptInvitationAction(token: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  const h = await headers();
  let email: string;
  try {
    ({ email } = await acceptInvitation(
      token,
      {
        email: values.email ?? "",
        name: values.name ?? "",
        password: values.password ?? "",
        confirm: values.confirm ?? "",
      },
      {
        ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: h.get("user-agent"),
      },
    ));
  } catch (error) {
    // Never send the passwords back to the browser.
    delete values.password;
    delete values.confirm;
    return toFormState(error, values);
  }
  redirect(`/sign-in?next=/portal&welcome=1&email=${encodeURIComponent(email)}`);
}
