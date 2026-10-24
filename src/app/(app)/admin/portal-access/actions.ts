"use server";

import { refresh } from "next/cache";
import type { PortalKind } from "@/generated/prisma/enums";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  invitePortalUser,
  revokeInvitation,
  revokePortalAccount,
  updatePortalPermissions,
} from "@/server/portal/access";
import { env } from "@/lib/env";

export type InviteState = FormState & { link?: string; email?: string };

/** Invites someone and hands back the link, shown once. */
export async function inviteAction(
  kind: PortalKind,
  id: string,
  _: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const values = formValues(formData);
  try {
    const { invitation, token } = await invitePortalUser(
      await requireActor(),
      { kind, id },
      {
        name: values.name ?? "",
        email: values.email ?? "",
        contactId: values.contactId,
        permissions: formData.getAll("permissions").map(String),
      },
    );
    refresh();
    return {
      status: "success",
      savedAt: Date.now(),
      email: invitation.email,
      link: new URL(`/invite/${token}`, env().APP_URL).toString(),
    };
  } catch (error) {
    return toFormState(error, values);
  }
}

export async function revokeInvitationAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async () => revokeInvitation(await requireActor(), id),
    "Invitation revoked",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function updatePermissionsAction(accountId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async () =>
      updatePortalPermissions(await requireActor(), accountId, {
        permissions: formData.getAll("permissions").map(String),
      }),
    "Saved",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function revokeAccountAction(accountId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async ({ comment }) =>
      revokePortalAccount(await requireActor(), accountId, { reason: comment ?? "" }),
    "Access revoked",
  );
  if (state.status === "success") refresh();
  return state;
}
