"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import { createPasswordLink, inviteStaff, revokeAccountLink } from "@/server/users/links";
import { assignRole, disableUser, enableUser, revokeRole } from "@/server/users/service";
import { env } from "@/lib/env";

export type LinkFormState = FormState & { link?: string; email?: string };

const linkUrl = (token: string) => new URL(`/sign-in/link/${token}`, env().APP_URL).toString();

/** Invites someone and hands back the link, shown once. */
export async function inviteStaffAction(
  _: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const values = formValues(formData);
  try {
    const { link, token } = await inviteStaff(await requireActor(), {
      name: values.name ?? "",
      email: values.email ?? "",
      roleKey: values.roleKey ?? "",
      legalEntityId: values.legalEntityId ?? "",
    });
    refresh();
    return { status: "success", savedAt: Date.now(), email: link.email, link: linkUrl(token) };
  } catch (error) {
    return toFormState(error, values);
  }
}

/** A link for someone to set a new password, shown once. */
export async function passwordLinkAction(
  userId: string,
  _: LinkFormState,
  formData: FormData,
): Promise<LinkFormState> {
  const values = formValues(formData);
  try {
    const { link, token } = await createPasswordLink(await requireActor(), userId, {
      resetTwoFactor: values.resetTwoFactor === "on",
    });
    refresh();
    return { status: "success", savedAt: Date.now(), email: link.email, link: linkUrl(token) };
  } catch (error) {
    return toFormState(error, values);
  }
}

export async function revokeLinkAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async () => revokeAccountLink(await requireActor(), id),
    "Link withdrawn",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function grantRoleAction(userId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => assignRole(await requireActor(), userId, v.roleKey ?? "", v.legalEntityId || null),
    "Role granted",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function revokeRoleAction(
  userId: string,
  roleKey: string,
  legalEntityId: string | null,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async () => revokeRole(await requireActor(), userId, roleKey, legalEntityId),
    "Role removed",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function setUserEnabledAction(
  userId: string,
  enabled: boolean,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async () => {
      const actor = await requireActor();
      return enabled ? enableUser(actor, userId) : disableUser(actor, userId);
    },
    enabled ? "Account enabled" : "Account disabled and signed out everywhere",
  );
  if (state.status === "success") refresh();
  return state;
}
