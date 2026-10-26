"use server";

import { headers } from "next/headers";
import { auth } from "@/server/auth/auth";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { changeOwnPassword } from "@/server/users/links";

export async function changePasswordAction(_: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => {
      const actor = await requireActor();
      const session = await auth.api.getSession({ headers: await headers() });
      await changeOwnPassword(
        actor,
        { current: v.current ?? "", password: v.password ?? "", confirm: v.confirm ?? "" },
        session?.session.id ?? null,
      );
    },
    "Password changed. You've been signed out on your other devices.",
  );
  // Never send passwords back to the browser.
  if (state.values) state.values = {};
  return state;
}
