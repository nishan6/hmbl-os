"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { redeemAccountLink } from "@/server/users/links";
import { formValues, toFormState, type FormState } from "@/server/http/action-result";

export async function redeemLinkAction(token: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  const h = await headers();
  let result: { email: string; purpose: "INVITE" | "RESET" };
  try {
    result = await redeemAccountLink(
      token,
      {
        email: values.email ?? "",
        name: values.name,
        password: values.password ?? "",
        confirm: values.confirm ?? "",
      },
      {
        ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: h.get("user-agent"),
      },
    );
  } catch (error) {
    // Never send the passwords back to the browser.
    delete values.password;
    delete values.confirm;
    return toFormState(error, values);
  }
  const welcome = result.purpose === "INVITE" ? "staff" : "password";
  redirect(`/sign-in?welcome=${welcome}&email=${encodeURIComponent(result.email)}`);
}
